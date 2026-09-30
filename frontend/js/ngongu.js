/* =========================================================
   BLANKUP — LANGUAGE SWITCHER
   VI ↔ EN
   File: frontend/js/ngongu.js
   ========================================================= */

(() => {
  "use strict";

  /* =====================================================
       1. TRANSLATION DICTIONARY
       ===================================================== */

  const translations = {
    /* ================= NAVBAR ================= */
    "Đã có tài khoản?": "Already have an account?",
    "Tác phẩm": "Artwork",
    "Đăng nhập ngay": "Login now",
    "Tính năng": "Features",
    "Quy trình": "How It Works",
    "Bộ sưu tập": "Collections",
    "Gói AI": "AI Plans",
    "AI Studio": "AI Studio",
    "Cộng đồng": "Community",

    "Chuyển đổi giao diện": "Toggle theme",
    "Đăng nhập": "Login",
    "Tạo thiết kế": "Create Design",

    /* ================= HERO ================= */

    "Thiết kế áo thun bằng AI": "AI T-Shirt Design",

    "Chiếc áo kể": "A T-Shirt That Tells",

    "câu chuyện của bạn.": "Your Story.",

    "Mô tả ý tưởng bằng vài dòng, AI vẽ nên tác phẩm độc nhất, xem trước 3D và đặt áo. Giao tận nơi trong 3–5 ngày.":
      "Describe your idea in a few lines. AI creates a unique artwork, lets you preview it in 3D, and order your shirt. Delivered to your door in 3–5 days.",

    "Tạo thiết kế miễn phí": "Create for Free",

    "Xem gói AI — Từ 0đ": "View AI Plans — From 0₫",

    "Xem cảm hứng": "Get Inspired",

    Prompt: "Prompt",

    "Một con rồng Việt Nam phong cách cyberpunk":
      "A Vietnamese dragon in cyberpunk style",

    "Blankup Studio": "Blankup Studio",

    "3D Preview": "3D Preview",

    "rồng Việt Nam cyberpunk neon…": "Vietnamese cyberpunk neon dragon…",

    "T-Shirt · Black · M": "T-Shirt · Black · M",

    "AI Design": "AI Design",

    "thiết kế": "designs",

    COD: "COD",

    /* ================= STATS ================= */

    "Thiết kế đã tạo": "Designs Created",

    "Khách hàng": "Customers",

    "Đơn hàng đã đặt": "Orders Placed",

    /* ================= TRUST ================= */

    "Freeship toàn quốc": "Free Nationwide Shipping",

    "Miễn phí giao hàng đơn từ 2 áo": "Free shipping for orders of 2+ shirts",

    "In chất lượng cao": "High-Quality Printing",

    "In chuyển nhiệt bền màu 100%": "100% durable heat-transfer printing",

    "Đổi trả 7 ngày": "7-Day Returns",

    "Kiểm tra áo trước khi thanh toán": "Check your shirt before payment",

    "Thanh toán linh hoạt": "Flexible Payment",

    "COD, chuyển khoản hoặc VNPay": "COD, bank transfer or VNPay",

    /* ================= MARQUEE ================= */

    "AI DESIGN STUDIO": "AI DESIGN STUDIO",

    "CUSTOM T-SHIRT": "CUSTOM T-SHIRT",

    "COD TOÀN QUỐC": "NATIONWIDE COD",

    "Ý TƯỞNG LÊN ÁO": "IDEAS ON T-SHIRTS",

    /* ================= FEATURES ================= */

    "Tính năng": "Features",

    "Từ ý tưởng đến": "From Idea to",

    "tác phẩm": "Artwork",

    "Mọi công cụ bạn cần để biến bất kỳ ý tưởng nào thành chiếc áo thun độc nhất":
      "Everything you need to turn any idea into a unique T-shirt.",

    "Mô tả ý tưởng — AI tạo artwork trong vài giây. Không cần biết thiết kế.":
      "Describe your idea — AI creates artwork in seconds. No design skills required.",

    "Xem thiết kế trên mockup áo 3D trước khi đặt hàng. xoay, kéo, chỉnh vị trí.":
      "Preview your design on a 3D shirt mockup before ordering. Rotate, drag and adjust its position.",

    "Đặt hàng COD": "COD Order",

    "Thanh toán khi nhận hàng. Kiểm tra áo trước khi trả tiền. An toàn 100%.":
      "Pay when your order arrives. Check your shirt before paying. 100% safe.",

    "Upload ảnh": "Upload Image",

    "Tải ảnh tham khảo, AI sẽ sáng tạo dựa trên ý tưởng của bạn.":
      "Upload a reference image and AI will create based on your idea.",

    /* ================= HOW IT WORKS ================= */

    "Quy trình": "How It Works",

    "Biến ý tưởng": "Turn Your Idea",

    "thành hiện thực": "Into Reality",

    "Ba bước đơn giản — từ ý tưởng đến chiếc áo trên tay bạn":
      "Three simple steps — from idea to the shirt in your hands.",

    "Chọn áo nền": "Choose a T-Shirt",

    "Chọn kiểu áo, màu sắc và form dáng yêu thích — canvas trắng cho ý tưởng của bạn.":
      "Choose your favorite shirt style, color and fit — a blank canvas for your idea.",

    "AI tạo design": "AI Creates Your Design",

    "Viết ý tưởng hoặc upload ảnh — AI biến thành artwork trong vài giây.":
      "Write your idea or upload an image — AI turns it into artwork in seconds.",

    "Nhận áo & mặc": "Receive & Wear",

    "Đặt hàng COD, giao tận nơi toàn quốc. Ý tưởng của bạn — trong tủ đồ của bạn.":
      "Order with COD and get nationwide delivery. Your idea — in your wardrobe.",

    /* ================= GALLERY ================= */

    "Cảm hứng": "Inspiration",

    "Thiết kế từ": "Designs from",

    "cộng đồng": "the Community",

    "Hàng ngàn ý tưởng đã thành hình — khám phá và lấy cảm hứng từ cộng đồng Blankup":
      "Thousands of ideas have come to life — explore and get inspired by the Blankup community.",

    "Tạo ý tưởng của bạn": "Create Your Idea",

    /* ================= COLLECTIONS ================= */

    "Bộ sưu tập": "Collections",

    "Khám phá": "Explore",

    "theo chủ đề": "by Theme",

    "Chọn một chủ đề — Blankup mở studio với ý tưởng và phong cách được chuẩn bị sẵn":
      "Choose a theme — Blankup opens the studio with ready-made ideas and styles.",

    "Rồng Việt Nam": "Vietnamese Dragon",

    "Rồng cuộn mình giữa neon — huyền thoại và hiện đại":
      "A dragon wrapped in neon — legendary and modern",

    "Tạo ngay →": "Create Now →",

    "Anime & Chibi": "Anime & Chibi",

    "Nhân vật hoạt hình bùng nổ cá tính trên từng đường kim":
      "Colorful characters bursting with personality in every stitch",

    "Hoài niệm Việt": "Vietnamese Nostalgia",

    "Phố cổ, hoa sen và những mảnh ký ức xưa cũ":
      "Ancient streets, lotus flowers and fragments of old memories",

    "Thanh lịch tối giản": "Minimalist Elegance",

    "Đường nét sạch sẽ, thông điệp rõ ràng — sang trọng nhẹ nhàng":
      "Clean lines, clear messages — effortless elegance",

    /* ================= STUDIO ================= */

    "Nơi ý tưởng": "Where Ideas",

    "lên áo": "Become T-Shirts",

    "AI Design Studio của Blankup biến mô tả của bạn thành tác phẩm nghệ thuật trên áo thun — không cần kỹ năng thiết kế.":
      "Blankup's AI Design Studio turns your descriptions into artwork for T-shirts — no design skills required.",

    "AI tối ưu prompt của bạn tự động":
      "AI automatically optimizes your prompt",

    "8 phong cách thiết kế chuyên nghiệp": "8 professional design styles",

    "3D preview với nhiều màu áo và kích cỡ":
      "3D preview with multiple shirt colors and sizes",

    "Tải design và chia sẻ cộng đồng":
      "Download designs and share with the community",

    "Vào Studio — Miễn phí": "Enter Studio — Free",

    "Đang tạo artwork": "Creating artwork",

    "Rồng Việt Nam cyberpunk neon…": "Vietnamese cyberpunk neon…",

    Minimal: "Minimal",

    Street: "Street",

    Anime: "Anime",

    /* ================= REVIEWS ================= */

    "Cộng đồng": "Community",

    "nói gì": "What They Say",

    "Bình luận thật từ những người đã tạo và chia sẻ thiết kế trên Blankup":
      "Real comments from people who have created and shared designs on Blankup.",

    /* ================= FAQ ================= */

    "Hỏi đáp": "FAQ",

    "Câu hỏi": "Frequently",

    "thường gặp": "Asked Questions",

    "Mọi thắc mắc trước khi bạn đặt chiếc áo đầu tiên":
      "Everything you need to know before ordering your first shirt.",

    "Áo được in bằng công nghệ gì? Có bền màu không?":
      "What printing technology is used? Is it durable?",

    "Chúng mình dùng công nghệ in chuyển nhiệt cao cấp lên vải 100% cotton — hình sắc nét, không nứt nẻ và bền màu sau nhiều lần giặt nếu bảo quản đúng cách (lộn trái áo khi giặt).":
      "We use high-quality heat-transfer printing on 100% cotton — sharp images that resist cracking and fading after many washes when properly cared for (turn the shirt inside out when washing).",

    "Tôi chưa biết thiết kế — dùng AI có khó không?":
      "I don't know how to design — is AI difficult to use?",

    'Rất đơn giản! Chỉ cần mô tả ý tưởng bằng tiếng Việt (ví dụ: "con mèo mặc áo samurai phong cách anime"), chọn phong cách, bấm Tạo. AI sẽ cho bạn artwork độc nhất trong vài giây.':
      'It\'s very simple! Just describe your idea (for example: "a cat wearing a samurai outfit in anime style"), choose a style and click Create. AI will generate unique artwork for you in seconds.',

    "Giao hàng mất bao lâu? Phí vận chuyển thế nào?":
      "How long does delivery take? What are the shipping fees?",

    "Thời gian sản xuất 2-3 ngày làm việc, giao hàng 1-3 ngày tùy khu vực. Miễn phí vận chuyển cho đơn từ 2 áo trở lên; đơn 1 áo tính phí theo đơn vị vận chuyển.":
      "Production takes 2–3 business days, followed by 1–3 days for delivery depending on the area. Free shipping for orders of 2 or more shirts; shipping fees apply to single-shirt orders.",

    "Tôi có thể kiểm tra áo trước khi trả tiền không?":
      "Can I check the shirt before paying?",

    "Có! Blankup hỗ trợ COD (thanh toán khi nhận hàng) toàn quốc — bạn được mở hàng, kiểm tra chất lượng in và size trước khi thanh toán cho shipper.":
      "Yes! Blankup supports nationwide COD — you can open the package and check the print quality and size before paying the delivery driver.",

    "Áo sai size hoặc không ưng ý thì sao?":
      "What if the shirt is the wrong size or I don't like it?",

    "Bạn được đổi trả trong 7 ngày kể từ khi nhận hàng nếu áo bị lỗi in, sai size hoặc sai thiết kế so với đơn đặt. Liên hệ qua fanpage hoặc hotline để được hỗ trợ hoàn toàn miễn phí.":
      "You can return or exchange the shirt within 7 days of receiving it if there is a printing defect, wrong size or incorrect design compared with your order. Contact our fanpage or hotline for free support.",

    "Design của tôi có thuộc về tôi không?": "Do I own my design?",

    "Hoàn toàn! Artwork bạn tạo là của riêng bạn. Bạn có thể tải file về, đặt in lại bất cứ lúc nào, và tùy chọn chia sẻ lên cộng đồng hoặc giữ riêng tư.":
      "Absolutely! The artwork you create belongs to you. You can download the file, reorder it anytime, and choose to share it with the community or keep it private.",

    /* ================= CTA ================= */

    "Bắt đầu ngay": "Get Started",

    "Ý tưởng của bạn": "Your Idea",

    "đang chờ": "Is Waiting",

    "Tạo thiết kế miễn phí với AI. Chỉ thanh toán khi bạn nhận được áo và hài lòng.":
      "Create your design for free with AI. Pay only when you receive and are happy with your shirt.",

    "Bắt đầu — Miễn phí": "Start — Free",

    "Miễn phí tạo design": "Free design creation",

    "COD toàn quốc": "Nationwide COD",

    "Hủy bất cứ lúc nào": "Cancel anytime",

    /* ================= COMMENTS ================= */

    "Bình luận": "Comments",

    Đóng: "Close",

    "Viết bình luận…": "Write a comment…",

    "Nội dung bình luận": "Comment content",

    Gửi: "Send",

    "Đăng nhập": "Login",

    " để bình luận về thiết kế này.": " to comment on this design.",

    /* ================= FOOTER ================= */

    "Nền tảng thiết kế áo thun bằng AI.": "AI-powered T-shirt design platform.",

    "Ý tưởng của bạn, lên áo.": "Your idea, on a T-shirt.",

    "Sản phẩm": "Products",

    "Áo thun": "T-Shirts",

    "Áo polo": "Polo Shirts",

    Hoodie: "Hoodies",

    "Hỗ trợ": "Support",

    "Giao hàng": "Shipping",

    "Đổi trả": "Returns",

    "Liên hệ": "Contact",

    "Pháp lý": "Legal",

    "Điều khoản": "Terms",

    "Bảo mật": "Privacy",

    "© 2026 Blankup. Mọi quyền được bảo lưu.":
      "© 2026 Blankup. All rights reserved.",

    "Thiết kế tại Việt Nam 🇻🇳": "Designed in Vietnam 🇻🇳",

    "Bỏ qua đến nội dung chính": "Skip to main content",
    /* ================= LOGIN ================= */

    "Đăng nhập vào Blankup": "Login to Blankup",

    "Nền tảng thiết kế áo bằng AI": "AI-powered T-shirt design platform",

    "Họ và tên": "Full Name",

    "Tên đăng nhập": "Username",

    "Email (khuyến nghị)": "Email (recommended)",

    "Số điện thoại": "Phone Number",

    "Mật khẩu": "Password",

    "Quên mật khẩu?": "Forgot password?",

    "Đăng nhập": "Login",

    "hoặc đăng nhập bằng": "or continue with",

    Google: "Google",

    Facebook: "Facebook",

    "Chưa có tài khoản?": "Don't have an account?",

    "Đăng ký ngay": "Register now",

    "← Quay lại Trang chủ": "← Back to Home",

    "Quay lại Trang chủ": "Back to Home",

    "email@example.com": "email@example.com",

    "0912345678": "0912345678",

    "Mật khẩu": "Password",

    /* ================= VERIFICATION ================= */

    "Xác thực tài khoản": "Account Verification",

    "Xác thực email & SĐT": "Verify Email & Phone",

    "Nhập mã xác thực 6 số đã gửi đến email và SĐT của bạn.":
      "Enter the 6-digit verification code sent to your email and phone.",

    "Mã xác thực email": "Email Verification Code",

    "Mã xác thực SĐT": "Phone Verification Code",

    "Gửi lại mã": "Resend Code",

    "Xác nhận": "Confirm",

    "← Quay lại Đăng nhập": "← Back to Login",

    123456: "123456",
    "Chưa có tài khoản?": "Don't have an account?",
    "Đăng ký ngay": "Register now",

    "Quay lại Trang chủ": "Back to Home",
    "← Quay lại Trang chủ": "← Back to Home",
    "Trang chủ": " Back to Home",
    "Họ và tên": " Full Name",
  };

  /* =====================================================
       2. REVERSE DICTIONARY
       Dùng khi chuyển EN → VI
       ===================================================== */

  const reverseTranslations = Object.fromEntries(
    Object.entries(translations).map(([vi, en]) => [en, vi]),
  );

  /* =====================================================
       3. STATE
       ===================================================== */

  let currentLanguage = localStorage.getItem("blankup-language") || "vi";

  /* =====================================================
       4. NORMALIZE TEXT
       ===================================================== */

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  /* =====================================================
       5. TRANSLATE TEXT NODE
       ===================================================== */

  function translateTextNode(node, language) {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const originalText = node.nodeValue;

    if (!originalText || !originalText.trim()) {
      return;
    }

    const normalized = normalizeText(originalText);

    if (!normalized) {
      return;
    }

    const dictionary = language === "en" ? translations : reverseTranslations;

    const translated = dictionary[normalized];

    if (!translated) {
      return;
    }

    /*
     * Giữ nguyên khoảng trắng trước/sau
     */
    const leadingSpace = originalText.match(/^\s*/)?.[0] || "";

    const trailingSpace = originalText.match(/\s*$/)?.[0] || "";

    node.nodeValue = leadingSpace + translated + trailingSpace;
  }

  /* =====================================================
       6. TRANSLATE ELEMENTS
       ===================================================== */

  function translateElement(element, language) {
    if (!element) {
      return;
    }

    /*
     * Không đụng vào script / style / SVG
     */
    if (
      element.tagName === "SCRIPT" ||
      element.tagName === "STYLE" ||
      element.tagName === "SVG"
    ) {
      return;
    }

    /*
     * Text nodes
     */
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;

        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        if (
          parent.tagName === "SCRIPT" ||
          parent.tagName === "STYLE" ||
          parent.closest("svg")
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];

    let node;

    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    textNodes.forEach((textNode) => {
      translateTextNode(textNode, language);
    });

    /* =================================================
           PLACEHOLDER
           ================================================= */

    const inputs = element.querySelectorAll("input, textarea");

    inputs.forEach((input) => {
      const placeholder = input.getAttribute("placeholder");

      if (!placeholder) {
        return;
      }

      const dictionary = language === "en" ? translations : reverseTranslations;

      const translated = dictionary[normalizeText(placeholder)];

      if (translated) {
        input.setAttribute("placeholder", translated);
      }
    });

    /* =================================================
           TITLE
           ================================================= */

    const titledElements = element.querySelectorAll("[title]");

    titledElements.forEach((item) => {
      const title = item.getAttribute("title");

      if (!title) {
        return;
      }

      const dictionary = language === "en" ? translations : reverseTranslations;

      const translated = dictionary[normalizeText(title)];

      if (translated) {
        item.setAttribute("title", translated);
      }
    });

    /* =================================================
           ARIA LABEL
           ================================================= */

    const ariaElements = element.querySelectorAll("[aria-label]");

    ariaElements.forEach((item) => {
      const aria = item.getAttribute("aria-label");

      if (!aria) {
        return;
      }

      const dictionary = language === "en" ? translations : reverseTranslations;

      const translated = dictionary[normalizeText(aria)];

      if (translated) {
        item.setAttribute("aria-label", translated);
      }
    });
  }

  /* =====================================================
       7. META / TITLE
       ===================================================== */

  function translateHead(language) {
    const dictionary = language === "en" ? translations : reverseTranslations;

    /* HTML LANG */

    document.documentElement.lang = language;
    document.documentElement.dataset.lang = language;

    /* TITLE */

    const title = document.querySelector("title");

    if (title) {
      if (language === "en") {
        title.textContent =
          "Blankup — Tell Your Story on a T-Shirt | AI Design Studio";
      } else {
        title.textContent =
          "Blankup — Kể câu chuyện của bạn trên chiếc áo | AI Design Studio";
      }
    }

    /* META DESCRIPTION */

    const description = document.querySelector('meta[name="description"]');

    if (description) {
      description.setAttribute(
        "content",
        language === "en"
          ? "Blankup - Turn your ideas into unique T-shirt artwork. Describe your idea, let AI create the design, preview it in 3D and order with COD."
          : "Blankup - Biến ý tưởng thành tác phẩm nghệ thuật trên áo thun. Mô tả ý tưởng, AI tạo design, xem trước 3D, đặt hàng COD.",
      );
    }

    /* OG TITLE */

    const ogTitle = document.querySelector('meta[property="og:title"]');

    if (ogTitle) {
      ogTitle.setAttribute(
        "content",
        language === "en"
          ? "Blankup — Tell Your Story on a T-Shirt | AI Design Studio"
          : "Blankup — Kể câu chuyện của bạn trên chiếc áo | AI Design Studio",
      );
    }

    /* OG DESCRIPTION */

    const ogDescription = document.querySelector(
      'meta[property="og:description"]',
    );

    if (ogDescription) {
      ogDescription.setAttribute(
        "content",
        language === "en"
          ? "Turn your ideas into unique T-shirt artwork. Describe your idea, let AI create the design, preview it in 3D and order with COD."
          : "Biến ý tưởng thành tác phẩm nghệ thuật trên áo thun. Mô tả ý tưởng, AI tạo design, xem trước 3D, đặt hàng COD.",
      );
    }
  }

  /* =====================================================
       8. LANGUAGE BUTTON
       ===================================================== */

  function updateLanguageButtons(language) {
    const buttons = document.querySelectorAll(".lang-btn");

    buttons.forEach((button, index) => {
      /*
       * HTML hiện tại:
       *
       * button 1 = VI
       * button 2 = EN
       */

      const buttonLanguage = button.dataset.lang || (index === 0 ? "vi" : "en");

      button.dataset.lang = buttonLanguage;

      button.classList.toggle("active", buttonLanguage === language);

      button.setAttribute(
        "aria-pressed",
        buttonLanguage === language ? "true" : "false",
      );
    });
  }

  /* =====================================================
       9. CHANGE LANGUAGE
       ===================================================== */

  function changeLanguage(language) {
    if (language !== "vi" && language !== "en") {
      language = "vi";
    }

    currentLanguage = language;

    /*
     * Đổi trạng thái HTML
     */

    document.documentElement.lang = language;
    document.documentElement.dataset.lang = language;

    /*
     * Đổi toàn bộ nội dung BODY
     */

    translateElement(document.body, language);

    /*
     * Đổi TITLE + META
     */

    translateHead(language);

    /*
     * Đổi nút VI / EN
     */

    updateLanguageButtons(language);

    /*
     * Lưu lựa chọn
     */

    localStorage.setItem("blankup-language", language);

    /*
     * Cho các JS khác biết ngôn ngữ đã thay đổi
     */

    document.dispatchEvent(
      new CustomEvent("blankupLanguageChanged", {
        detail: {
          language: language,
        },
      }),
    );
  }

  /* =====================================================
       10. CLICK VI / EN
       ===================================================== */

  function setupLanguageButtons() {
    const buttons = document.querySelectorAll(".lang-btn");

    buttons.forEach((button, index) => {
      const language = button.dataset.lang || (index === 0 ? "vi" : "en");

      button.dataset.lang = language;

      button.addEventListener("click", () => {
        changeLanguage(language);
      });
    });
  }

  /* =====================================================
       11. OBSERVER
       Theo dõi nội dung home.js tạo thêm
       ===================================================== */

  function setupMutationObserver() {
    let translating = false;

    const observer = new MutationObserver((mutations) => {
      if (translating) {
        return;
      }

      const hasNewContent = mutations.some(
        (mutation) =>
          mutation.type === "childList" && mutation.addedNodes.length > 0,
      );

      if (!hasNewContent) {
        return;
      }

      translating = true;

      requestAnimationFrame(() => {
        /*
         * Chỉ dịch phần mới được thêm
         */

        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              translateElement(node, currentLanguage);
            }

            if (node.nodeType === Node.TEXT_NODE) {
              translateTextNode(node, currentLanguage);
            }
          });
        });

        translating = false;
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /* =====================================================
       12. INIT
       ===================================================== */

  function init() {
    setupLanguageButtons();

    changeLanguage(currentLanguage);

    setupMutationObserver();

    console.log(
      `%cBlankup Language: ${currentLanguage.toUpperCase()}`,
      "font-weight:700;color:#c19856;",
    );
  }

  /* =====================================================
       13. START
       ===================================================== */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// placeholder ngôn ngữ
