// frontend/js/login.js
/**
 * Blankup Dedicated Login Page Logic
 * Integrates with auth.js to handle login/register/verify operations and redirects.
 */

document.addEventListener("DOMContentLoaded", () => {
  // If user is already logged in, redirect them away from login page
  if (auth.isLoggedIn()) {
    redirectAfterLogin();
    return;
  }

  // State
  let isRegisterMode = false;
  let pendingVerifyUserId = null;
  let pendingVerifyMethods = [];

  // UX reliability: busy guards prevent double-submit / duplicate OTP sends
  const _busy = new Set();
  function busyGuard(key) {
    if (_busy.has(key)) return true;
    _busy.add(key);
    return false;
  }
  function busyRelease(key) {
    _busy.delete(key);
  }

  // ---- Login/Register form elements ----
  const form = document.getElementById("loginForm");
  const title = document.getElementById("loginTitle");
  const fullNameGroup = document.getElementById("fullNameGroup");
  const loginFullName = document.getElementById("loginFullName");
  const emailGroup = document.getElementById("emailGroup");
  const loginEmail = document.getElementById("loginEmail");
  const phoneGroup = document.getElementById("phoneGroup");
  const loginPhone = document.getElementById("loginPhone");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const submitText = document.getElementById("loginSubmitText");
  const switchPrompt = document.getElementById("loginSwitchPrompt");
  const switchBtn = document.getElementById("loginSwitchBtn");
  const errorMsg = document.getElementById("loginErrorMsg");
  const submitBtn = document.getElementById("loginSubmitBtn");

  // ---- Verification form elements ----
  const verifySection = document.getElementById("verificationSection");
  const verifyForm = document.getElementById("verifyForm");
  const verifyEmailGroup = document.getElementById("verifyEmailGroup");
  const verifyPhoneGroup = document.getElementById("verifyPhoneGroup");
  const verifyEmailCode = document.getElementById("verifyEmailCode");
  const verifyPhoneCode = document.getElementById("verifyPhoneCode");
  const verifyEmailHint = document.getElementById("verifyEmailHint");
  const verifyPhoneHint = document.getElementById("verifyPhoneHint");
  const resendEmailBtn = document.getElementById("resendEmailBtn");
  const resendPhoneBtn = document.getElementById("resendPhoneBtn");
  const verifyErrorMsg = document.getElementById("verifyErrorMsg");
  const verifySuccessMsg = document.getElementById("verifySuccessMsg");
  const verifySubmitBtn = document.getElementById("verifySubmitBtn");
  const loginCard = document.querySelector(".login-card");

  // ---- Social login (Google / Facebook) ----
  const googleBtn = document.getElementById("googleLoginBtn");
  const facebookBtn = document.getElementById("facebookLoginBtn");
  const socialCfg = window.BLANKUP_SOCIAL || {};

  function showSocialError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = "block";
  }

  async function completeSocialLogin(provider, profile) {
    let payload;
    if (provider === "google") {
      if (!profile.idToken) return;
      payload = { provider, idToken: profile.idToken };
    } else {
      if (!profile.providerId || !profile.fullName) return;
      payload = {
        provider,
        providerId: profile.providerId,
        email: profile.email || null,
        fullName: profile.fullName,
        avatar: profile.avatar || null,
      };
    }
    try {
      const res = await fetch("/api/auth/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showSocialError(data.error || "Đăng nhập mạng xã hội thất bại.");
        return;
      }
      auth.token = data.token;
      auth.user = data.user;
      localStorage.setItem("blankup_token", data.token);
      localStorage.setItem("blankup_user", JSON.stringify(data.user));
      auth.updateNavbar();
      redirectAfterLogin();
    } catch {
      showSocialError("Không thể kết nối máy chủ. Vui lòng thử lại.");
    }
  }

  if (googleBtn) {
    googleBtn.addEventListener("click", () => {
      errorMsg.style.display = "none";
      if (!socialCfg.googleClientId) {
        showSocialError(
          "Đăng nhập Google chưa được cấu hình. Vui lòng đăng nhập bằng tài khoản thường.",
        );
        return;
      }
      googleBtn.disabled = true;
      if (typeof google === "undefined") {
        showSocialError("Không thể tải Google Sign-In. Vui lòng thử lại.");
        googleBtn.disabled = false;
        return;
      }
      google.accounts.id.initialize({
        client_id: socialCfg.googleClientId,
        callback: (response) => {
          googleBtn.disabled = false;
          if (!response.credential) {
            showSocialError("Không nhận được thông tin từ Google.");
            return;
          }
          completeSocialLogin("google", { idToken: response.credential });
        },
      });
      google.accounts.id.prompt();
    });
  }

  if (facebookBtn) {
    facebookBtn.addEventListener("click", () => {
      errorMsg.style.display = "none";
      // Server-side OAuth: redirect to backend which then redirects to Facebook
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "";
      const target =
        "/api/auth/facebook" +
        (redirect ? `?redirect=${encodeURIComponent(redirect)}` : "");
      window.location.href = target;
    });
  }

  // Toggle between Login and Register
  if (switchBtn) {
    switchBtn.addEventListener("click", () => {
      isRegisterMode = !isRegisterMode;
      errorMsg.style.display = "none";
      form.reset();

      if (isRegisterMode) {
        title.setAttribute("data-i18n", "auth.modal.registerTitle");
        fullNameGroup.style.display = "block";
        loginFullName.required = true;
        if (emailGroup) emailGroup.style.display = "block";
        if (phoneGroup) phoneGroup.style.display = "block";
        if (forgotPasswordLink) forgotPasswordLink.style.display = "none";
        submitText.setAttribute("data-i18n", "auth.modal.registerBtn");
        switchPrompt.setAttribute("data-i18n", "auth.modal.hasAccount");
        switchBtn.setAttribute("data-i18n", "auth.modal.switchToLogin");
      } else {
        title.setAttribute("data-i18n", "auth.modal.title");
        fullNameGroup.style.display = "none";
        loginFullName.required = false;
        if (emailGroup) emailGroup.style.display = "none";
        if (phoneGroup) phoneGroup.style.display = "none";
        if (forgotPasswordLink) forgotPasswordLink.style.display = "block";
        submitText.setAttribute("data-i18n", "auth.modal.loginBtn");
        switchPrompt.setAttribute("data-i18n", "auth.modal.noAccount");
        switchBtn.setAttribute("data-i18n", "auth.modal.switchToRegister");
      }

      if (window.i18n && typeof window.i18n.updateDOM === "function") {
        window.i18n.updateDOM();
      }
    });
  }

  // Handle Form Submission
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = document.getElementById("loginUsername").value.trim();
      const password = document.getElementById("loginPassword").value;

      errorMsg.style.display = "none";
      submitBtn.disabled = true;

      const origBtnHtml = submitBtn.innerHTML;
      submitBtn.innerHTML = `<span class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-radius:50%; border-top-color:#fff; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></span> <span data-i18n="auth.modal.loading">Đang xử lý...</span>`;
      if (window.i18n) window.i18n.updateDOM();

      let result;
      if (isRegisterMode) {
        const fullName = loginFullName.value.trim();
        const email = loginEmail ? loginEmail.value.trim() : "";
        const phone = loginPhone ? loginPhone.value.trim() : "";
        if (!email && !phone) {
          errorMsg.textContent =
            "Vui lòng nhập email hoặc số điện thoại để xác thực.";
          errorMsg.style.display = "block";
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnHtml;
          if (window.i18n) window.i18n.updateDOM();
          return;
        }
        result = await auth.register(
          username,
          password,
          fullName,
          email,
          phone,
        );
      } else {
        result = await auth.login(username, password);
      }

      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml;
      if (window.i18n) window.i18n.updateDOM();

      if (result.success) {
        if (result.requiresVerification) {
          // Show verification form
          pendingVerifyUserId = result.userId;
          pendingVerifyMethods = result.verificationMethods || [];
          showVerificationForm();
          // Initial send just happened server-side: start UX cooldown now.
          applyResendAvailableAt(
            result.resendAvailableAt,
            pendingVerifyMethods,
          );
          if (result.deliveryWarning) {
            verifyErrorMsg.textContent = result.deliveryWarning;
            verifyErrorMsg.style.display = "block";
          }
        } else {
          auth.updateNavbar();
          redirectAfterLogin();
        }
      } else if (result.requiresVerification) {
        // Login returned verification required
        pendingVerifyUserId = result.userId;
        pendingVerifyMethods = result.verificationMethods || [];
        showVerificationForm();
      } else {
        errorMsg.textContent = result.error;
        errorMsg.style.display = "block";
      }
    });
  }

  // ---- Resend cooldown (UX only — backend enforces 120s per pending+channel) ----
  // Deadline persists in localStorage so reload/new tab keeps the countdown.
  // The backend remains the source of truth (429 + retryAfterSeconds).
  const RESEND_COOLDOWN_SECONDS = 120;
  const cooldownTimers = {};

  function resendDeadlineKey(type) {
    return `blankup_resend_${pendingVerifyUserId || "unknown"}_${type}`;
  }

  function remainingCooldown(type) {
    try {
      const deadline = Number(
        localStorage.getItem(resendDeadlineKey(type)) || 0,
      );
      return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    } catch {
      return 0;
    }
  }

  function resendButtonFor(type) {
    return type === "email" ? resendEmailBtn : resendPhoneBtn;
  }

  function startCooldown(type, seconds) {
    const btn = resendButtonFor(type);
    if (!btn) return;
    const secs = Math.max(
      0,
      Math.min(
        RESEND_COOLDOWN_SECONDS,
        Number(seconds) || RESEND_COOLDOWN_SECONDS,
      ),
    );
    try {
      localStorage.setItem(
        resendDeadlineKey(type),
        String(Date.now() + secs * 1000),
      );
    } catch {}
    if (cooldownTimers[type]) clearInterval(cooldownTimers[type]);
    const tick = () => {
      const left = remainingCooldown(type);
      if (left <= 0) {
        clearInterval(cooldownTimers[type]);
        delete cooldownTimers[type];
        btn.disabled = false;
        btn.textContent = "Gửi lại mã";
        return;
      }
      btn.disabled = true;
      btn.textContent = `Gửi lại (${left}s)`;
    };
    tick();
    cooldownTimers[type] = setInterval(tick, 1000);
  }

  function restoreCooldowns() {
    for (const type of pendingVerifyMethods) {
      if (remainingCooldown(type) > 0)
        startCooldown(type, remainingCooldown(type));
    }
  }

  function applyResendAvailableAt(resendAvailableAt, types) {
    if (!resendAvailableAt) return;
    const waitMs = new Date(resendAvailableAt).getTime() - Date.now();
    if (waitMs <= 0) return;
    for (const type of types || pendingVerifyMethods) {
      startCooldown(type, Math.ceil(waitMs / 1000));
    }
  }

  // ---- Verification Form ----
  function showVerificationForm() {
    // Hide login card, show verification card
    const loginMain = document.querySelector(".login-main");
    if (loginMain) loginMain.style.display = "none";
    if (verifySection) verifySection.style.display = "block";

    // Show/hide OTP fields based on methods
    if (verifyEmailGroup)
      verifyEmailGroup.style.display = pendingVerifyMethods.includes("email")
        ? "block"
        : "none";
    if (verifyPhoneGroup)
      verifyPhoneGroup.style.display = pendingVerifyMethods.includes("phone")
        ? "block"
        : "none";

    // Set hints
    if (pendingVerifyMethods.includes("email")) {
      verifyEmailHint.textContent = "Mã hết hạn sau 2 phút";
    }
    if (pendingVerifyMethods.includes("phone")) {
      verifyPhoneHint.textContent = "Mã hết hạn sau 2 phút";
    }

    // Resume any active resend cooldown (reload-safe UX; backend enforces truth)
    restoreCooldowns();

    // Clear previous state
    if (verifyEmailCode) verifyEmailCode.value = "";
    if (verifyPhoneCode) verifyPhoneCode.value = "";
    if (verifyErrorMsg) verifyErrorMsg.style.display = "none";
    if (verifySuccessMsg) verifySuccessMsg.style.display = "none";

    // Focus first visible input
    setTimeout(() => {
      if (pendingVerifyMethods.includes("email") && verifyEmailCode)
        verifyEmailCode.focus();
      else if (pendingVerifyMethods.includes("phone") && verifyPhoneCode)
        verifyPhoneCode.focus();
    }, 100);
  }

  // Handle verification form submit
  if (verifyForm) {
    verifyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!pendingVerifyUserId) return;
      if (busyGuard("verifyForm")) return; // duplicate action prevention

      verifyErrorMsg.style.display = "none";
      verifySuccessMsg.style.display = "none";
      verifySubmitBtn.disabled = true;
      const origHtml = verifySubmitBtn.innerHTML;
      verifySubmitBtn.innerHTML = "<span>Đang xác nhận...</span>";

      try {
        let allVerified = true;

        // Verify email if needed
        if (pendingVerifyMethods.includes("email") && verifyEmailCode) {
          const code = verifyEmailCode.value.trim();
          if (code.length !== 6) {
            throw new Error("Mã email phải đủ 6 chữ số.");
          }
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: pendingVerifyUserId,
              type: "email",
              code,
            }),
          });
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.error || "Xác thực email thất bại.");
          allVerified = data.allVerified !== false;
        }

        // Verify phone if needed
        if (pendingVerifyMethods.includes("phone") && verifyPhoneCode) {
          const code = verifyPhoneCode.value.trim();
          if (code.length !== 6) {
            throw new Error("Mã SĐT phải đủ 6 chữ số.");
          }
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: pendingVerifyUserId,
              type: "phone",
              code,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Xác thực SĐT thất bại.");
          allVerified = data.allVerified !== false;
        }

        if (allVerified) {
          verifySuccessMsg.textContent =
            "Xác thực thành công! Đang đăng nhập...";
          verifySuccessMsg.style.display = "block";
          // Auto-login
          setTimeout(async () => {
            // We don't have password in memory after register, so just redirect to login
            window.location.href = "/login.html";
          }, 1500);
        } else {
          verifySuccessMsg.textContent =
            "Đã xác thực một phương thức. Vui lòng hoàn thành phần còn lại.";
          verifySuccessMsg.style.display = "block";
        }
      } catch (err) {
        verifyErrorMsg.textContent = err.message;
        verifyErrorMsg.style.display = "block";
      } finally {
        busyRelease("verifyForm");
        verifySubmitBtn.disabled = false;
        verifySubmitBtn.innerHTML = origHtml;
      }
    });
  }

  async function handleResend(type) {
    if (!pendingVerifyUserId) return;
    const btn = resendButtonFor(type);
    const hint = type === "email" ? verifyEmailHint : verifyPhoneHint;
    // UX guard only — backend 120s cooldown is the real enforcement.
    const left = remainingCooldown(type);
    if (left > 0) {
      if (hint)
        hint.textContent = `Vui lòng chờ ${left}s trước khi gửi lại mã.`;
      return;
    }
    const busyKey = type === "email" ? "resendEmail" : "resendPhone";
    if (busyGuard(busyKey)) return; // duplicate OTP prevention
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang gửi...";
    }
    try {
      const res = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingVerifyUserId, type }),
      });
      const data = await res.json();
      if (res.status === 429) {
        // Backend cooldown — sync UX countdown from server truth.
        const wait = Number(data.retryAfterSeconds) || RESEND_COOLDOWN_SECONDS;
        startCooldown(type, wait);
        if (hint)
          hint.textContent = `Vui lòng chờ ${wait}s trước khi gửi lại mã.`;
        return;
      }
      if (!res.ok) throw new Error(data.error);
      if (data.deliveryWarning && hint) {
        hint.textContent = data.deliveryWarning;
      } else if (hint) {
        hint.textContent = "Đã gửi mã mới! Hết hạn sau 2 phút";
      }
      if (data.resendAvailableAt) {
        applyResendAvailableAt(data.resendAvailableAt, [type]);
      } else {
        startCooldown(type, RESEND_COOLDOWN_SECONDS);
      }
    } catch (err) {
      verifyErrorMsg.textContent = err.message || "Không thể gửi lại mã.";
      verifyErrorMsg.style.display = "block";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Gửi lại mã";
      }
    } finally {
      busyRelease(busyKey);
    }
  }

  // Resend email OTP
  if (resendEmailBtn) {
    resendEmailBtn.addEventListener("click", () => handleResend("email"));
  }

  // Resend phone OTP
  if (resendPhoneBtn) {
    resendPhoneBtn.addEventListener("click", () => handleResend("phone"));
  }

  // Auto-submit when all 6 digits entered
  [verifyEmailCode, verifyPhoneCode].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^0-9]/g, "").slice(0, 6);
      if (input.value.length === 6) {
        // Check if other required fields are also filled
        const emailRequired =
          pendingVerifyMethods.includes("email") && input !== verifyEmailCode;
        const phoneRequired =
          pendingVerifyMethods.includes("phone") && input !== verifyPhoneCode;
        const emailFilled =
          !pendingVerifyMethods.includes("email") ||
          (verifyEmailCode && verifyEmailCode.value.length === 6);
        const phoneFilled =
          !pendingVerifyMethods.includes("phone") ||
          (verifyPhoneCode && verifyPhoneCode.value.length === 6);
        if (emailFilled && phoneFilled) {
          verifyForm.dispatchEvent(new Event("submit"));
        }
      }
    });
  });
});

// Helper function to redirect user after successful login
function redirectAfterLogin() {
  const host = window.location.hostname;
  const isLocalMachine =
    host === "localhost" || host === "127.0.0.1" || host === "::1";
  const redirectTarget = getSafeRedirectTarget();

  if (redirectTarget) {
    window.location.href = redirectTarget;
    return;
  }

  // Admin can ONLY access the dashboard from the server machine (localhost)
  if (auth.isAdmin() && isLocalMachine) {
    window.location.href = "/admin.html";
  } else {
    // Check if we came from another page in the app (like studio.html)
    const referrer = document.referrer;
    if (
      referrer &&
      referrer.includes(window.location.origin) &&
      !referrer.includes("login.html") &&
      !referrer.includes("admin.html")
    ) {
      window.location.href = referrer;
    } else {
      window.location.href = "/";
    }
  }
}

function getSafeRedirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect");
  if (!redirect) return "";

  try {
    const target = new URL(redirect, window.location.origin);
    if (target.origin !== window.location.origin) return "";
    if (
      target.pathname.includes("login.html") ||
      target.pathname.includes("admin.html")
    )
      return "";
    return target.pathname + target.search + target.hash;
  } catch (_err) {
    return "";
  }
}
