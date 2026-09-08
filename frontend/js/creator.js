// frontend/js/creator.js
const API_BASE = window.location.origin + '/api';

let creatorData = null;

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const username = (params.get('user') || '').trim();

  if (!username) {
    showEmpty();
    return;
  }

  initListModal();
  loadCreatorProfile(username);
});

function loadCreatorProfile(username) {
  fetch(`${API_BASE}/users/${encodeURIComponent(username)}`)
    .then(resp => resp.json())
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Không tìm thấy creator.');
      creatorData = result.data;
      renderCreator(result.data);
    })
    .catch(err => {
      console.error('Creator load error:', err);
      showEmpty();
    });
}

function renderCreator(data) {
  document.getElementById('creatorLoading').style.display = 'none';
  document.getElementById('creatorEmpty').style.display = 'none';
  document.getElementById('creatorContent').style.display = 'block';
  document.title = `${data.user.fullName || data.user.username} - Creator Blankup`;

  const avatarEl = document.getElementById('creatorAvatar');
  const initial = (data.user.fullName || data.user.username || '?').trim().charAt(0).toUpperCase();
  avatarEl.textContent = initial;
  if (data.user.avatar) {
    avatarEl.style.backgroundImage = `url(${data.user.avatar})`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    avatarEl.textContent = '';
  }

  document.getElementById('creatorName').textContent = data.user.fullName || data.user.username;
  document.getElementById('creatorUsername').textContent = '@' + data.user.username;
  document.getElementById('creatorJoin').textContent = formatJoinDate(data.user.createdAt);
  const providerBadge = document.getElementById('creatorProvider');
  if (data.user.provider && data.user.provider !== 'local') {
    providerBadge.textContent = data.user.provider;
    providerBadge.style.display = 'inline-block';
  }

  document.getElementById('statDesigns').textContent = data.stats.designsCount;
  document.getElementById('statFollowers').textContent = data.stats.followersCount;
  document.getElementById('statFollowing').textContent = data.stats.followingCount;
  document.getElementById('statLikes').textContent = data.stats.totalLikes;
  document.getElementById('creatorDesignsCount').textContent = `${data.stats.designsCount} thiết kế`;

  // Follow button state
  const followBtn = document.getElementById('creatorFollowBtn');
  const selfBadge = document.getElementById('creatorSelfBadge');
  const goStudio = document.getElementById('creatorGoStudio');

  if (auth.token && auth.user) {
    if (auth.user.id === data.user.id) {
      selfBadge.style.display = 'inline-block';
      goStudio.style.display = 'inline-flex';
      followBtn.style.display = 'none';
    } else {
      followBtn.style.display = 'inline-flex';
      followBtn.textContent = data.isFollowing ? 'Đang theo dõi' : 'Theo dõi';
      followBtn.classList.toggle('btn-following', data.isFollowing);
      followBtn.addEventListener('click', toggleFollow);
    }
  } else {
    followBtn.style.display = 'inline-flex';
    followBtn.textContent = 'Theo dõi';
    followBtn.addEventListener('click', () => {
      window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
    });
  }

  renderDesigns(data.designs);

  // Followers/Following modals
  document.querySelector('.creator-stat[data-stat="followers"]').addEventListener('click', () => openListModal('followers'));
  document.querySelector('.creator-stat[data-stat="following"]').addEventListener('click', () => openListModal('following'));
}

function renderDesigns(designs) {
  const grid = document.getElementById('creatorDesignsGrid');
  if (designs.length === 0) {
    grid.innerHTML = `
      <div class="creator-empty-small">
        <p>Creator này chưa chia sẻ thiết kế nào.</p>
        <a href="/studio.html" class="btn btn-primary btn-sm">Thử tạo thiết kế ngay</a>
      </div>`;
    return;
  }

  grid.innerHTML = designs.map(d => `
    <a class="creator-design-card" href="/studio.html?designUrl=${encodeURIComponent(d.designUrl || '')}&prompt=${encodeURIComponent(d.prompt || '')}&style=${encodeURIComponent(d.style || 'abstract')}&author=${encodeURIComponent(d.author || '')}">
      <div class="creator-design-thumb">
        <img src="${escapeHtml(d.designUrl)}" alt="Thiết kế ${escapeHtml(String(d.prompt || '').slice(0, 80))}" loading="lazy">
        <div class="creator-design-likes"><svg class="creator-likes-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> <span>${Number(d.likes) || 0}</span></div>
      </div>
      <div class="creator-design-body">
        <p class="creator-design-prompt">${escapeHtml((d.prompt || '').slice(0, 120))}</p>
        <span class="creator-design-date">${formatJoinDate(d.sharedAt)}</span>
      </div>
    </a>
  `).join('');
}

let followBusy = false;
async function toggleFollow() {
  if (followBusy) return;
  const btn = document.getElementById('creatorFollowBtn');
  followBusy = true;
  if (btn) btn.disabled = true;
  try {
    const resp = await fetch(`${API_BASE}/users/${encodeURIComponent(creatorData.user.username)}/follow`, {
      method: 'POST',
      headers: auth.getAuthHeaders(),
    });
    const result = await resp.json();
    if (!resp.ok || result.success === false) throw new Error(result.error || 'Không thể cập nhật theo dõi.');

    const next = result.following;
    btn.textContent = next ? 'Đang theo dõi' : 'Theo dõi';
    btn.classList.toggle('btn-following', next);
    document.getElementById('statFollowers').textContent = next
      ? creatorData.stats.followersCount + 1
      : Math.max(0, creatorData.stats.followersCount - 1);
    creatorData.stats.followersCount = next ? creatorData.stats.followersCount + 1 : creatorData.stats.followersCount - 1;
  } catch (err) {
    console.error('Follow error:', err);
    // UX reliability: follow action must never fail silently
    if (window.showToast) window.showToast('Không thể cập nhật theo dõi. Vui lòng thử lại.', 'error');
  } finally {
    followBusy = false;
    if (btn) btn.disabled = false;
  }
}

function initListModal() {
  document.getElementById('creatorListClose')?.addEventListener('click', closeListModal);
  document.getElementById('creatorListModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'creatorListModal') closeListModal();
  });
}

function openListModal(kind) {
  if (!creatorData) return;
  const modal = document.getElementById('creatorListModal');
  const title = document.getElementById('creatorListTitle');
  const content = document.getElementById('creatorListContent');
  title.textContent = kind === 'followers' ? 'Người theo dõi' : 'Đang theo dõi';
  content.innerHTML = '<div class="creator-list-loading">Đang tải...</div>';
  modal.classList.add('open');

  fetch(`${API_BASE}/users/${encodeURIComponent(creatorData.user.username)}/${kind}`)
    .then(resp => resp.json())
    .then(result => {
      const list = result.data || [];
      if (list.length === 0) {
        content.innerHTML = '<div class="creator-list-empty">Chưa có ai ở đây.</div>';
        return;
      }
      content.innerHTML = list.map(u => `
        <a class="creator-list-item" href="/creator.html?user=${encodeURIComponent(u.username)}">
          <div class="creator-list-avatar">${escapeHtml((u.fullName || u.username || '?').charAt(0).toUpperCase())}</div>
          <div>
            <div class="creator-list-name">${escapeHtml(u.fullName || u.username)}</div>
            <div class="creator-list-username">@${escapeHtml(u.username)}</div>
          </div>
        </a>
      `).join('');
    })
    .catch(() => {
      content.innerHTML = '<div class="creator-list-empty">Không thể tải danh sách.</div>';
    });
}

function closeListModal() {
  document.getElementById('creatorListModal')?.classList.remove('open');
}

function showEmpty() {
  document.getElementById('creatorLoading').style.display = 'none';
  document.getElementById('creatorContent').style.display = 'none';
  document.getElementById('creatorEmpty').style.display = 'block';
}

function formatJoinDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `Tham gia ${d.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
