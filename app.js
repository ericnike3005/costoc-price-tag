// ---- Firebase config ----
const firebaseConfig = {
  apiKey: "AIzaSyCCLuJoVC8VLGhH0ljDWFKPeEKF73B8Pdw",
  authDomain: "costco-price-tag.firebaseapp.com",
  projectId: "costco-price-tag",
  storageBucket: "costco-price-tag.firebasestorage.app",
  messagingSenderId: "667155129804",
  appId: "1:667155129804:web:bf3e473d2d3c5c0b8f2969"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// enable offline cache (works offline, syncs when back online)
db.enablePersistence().catch(() => {});

let products = [];
let expandedId = null;
let unsubscribeSnapshot = null;
let isSignup = false;

const listEl = document.getElementById('list');
const countLabel = document.getElementById('countLabel');
const searchInput = document.getElementById('searchInput');
const overlay = document.getElementById('overlay');
const authScreen = document.getElementById('authScreen');
const appEl = document.getElementById('app');
const authError = document.getElementById('authError');

function fmt(n){
  if(n === null || n === undefined || isNaN(n)) return '-';
  return Number(n).toLocaleString('ko-KR');
}
function marginPct(cost, price){
  if(!price || price <= 0) return 0;
  return ((price - cost) / price) * 100;
}
function discountStatus(p){
  if(p.discountPrice === null || p.discountPrice === undefined || p.discountPrice === '') return null;
  const now = new Date();
  now.setHours(0,0,0,0);
  const start = p.discountStart ? new Date(p.discountStart) : null;
  const end = p.discountEnd ? new Date(p.discountEnd) : null;
  if(end){ end.setHours(0,0,0,0); if(now > end) return 'expired'; }
  if(start){ start.setHours(0,0,0,0); if(now < start) return 'upcoming'; }
  return 'active';
}
function fmtDate(d){
  if(!d) return '';
  const dt = new Date(d);
  return `${dt.getMonth()+1}/${dt.getDate()}`;
}
function daysLeft(end){
  if(!end) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const e = new Date(end); e.setHours(0,0,0,0);
  return Math.round((e - now) / 86400000);
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 1600);
}
function timeAgo(iso){
  if(!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs/60000);
  if(min < 1) return '방금 수정';
  if(min < 60) return min + '분 전 수정';
  const hr = Math.floor(min/60);
  if(hr < 24) return hr + '시간 전 수정';
  const day = Math.floor(hr/24);
  return day + '일 전 수정';
}

// ---- AUTH ----
auth.onAuthStateChanged((user) => {
  if(user){
    authScreen.style.display = 'none';
    appEl.style.display = 'block';
    subscribeToProducts(user.uid);
  } else {
    authScreen.style.display = 'flex';
    appEl.style.display = 'none';
    if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    products = [];
  }
});

function showAuthError(msg){
  authError.textContent = msg;
  authError.classList.add('show');
}
function clearAuthError(){
  authError.classList.remove('show');
}

document.getElementById('authToggleLink').addEventListener('click', () => {
  isSignup = !isSignup;
  clearAuthError();
  document.getElementById('authSubmit').textContent = isSignup ? '회원가입' : '로그인';
  document.getElementById('authToggleText').textContent = isSignup ? '이미 계정이 있어?' : '계정이 없어?';
  document.getElementById('authToggleLink').textContent = isSignup ? '로그인' : '회원가입';
});

document.getElementById('authSubmit').addEventListener('click', async () => {
  clearAuthError();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){
    showAuthError('이메일과 비밀번호를 입력해줘');
    return;
  }
  const btn = document.getElementById('authSubmit');
  btn.disabled = true;
  try{
    if(isSignup){
      await auth.createUserWithEmailAndPassword(email, password);
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  }catch(e){
    const messages = {
      'auth/invalid-email': '이메일 형식이 올바르지 않아',
      'auth/user-not-found': '가입되지 않은 이메일이야',
      'auth/wrong-password': '비밀번호가 틀렸어',
      'auth/email-already-in-use': '이미 가입된 이메일이야',
      'auth/weak-password': '비밀번호는 6자 이상이어야 해',
      'auth/invalid-credential': '이메일 또는 비밀번호가 틀렸어'
    };
    showAuthError(messages[e.code] || e.message);
  }
  btn.disabled = false;
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  auth.signOut();
});

// ---- FIRESTORE SYNC ----
function subscribeToProducts(uid){
  if(unsubscribeSnapshot) unsubscribeSnapshot();
  document.getElementById('syncText').textContent = '동기화 중...';
  unsubscribeSnapshot = db.collection('products')
    .where('ownerId', '==', uid)
    .onSnapshot((snapshot) => {
      products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      document.getElementById('syncDot').classList.remove('offline');
      document.getElementById('syncText').textContent = '동기화됨';
      render();
    }, (err) => {
      document.getElementById('syncDot').classList.add('offline');
      document.getElementById('syncText').textContent = '오프라인 (로컬 캐시)';
    });
}

async function addProduct(name, cost, price, discountPrice, discountStart, discountEnd){
  const uid = auth.currentUser.uid;
  await db.collection('products').add({
    name, cost, price,
    discountPrice: (discountPrice === '' || discountPrice === null || discountPrice === undefined) ? null : Number(discountPrice),
    discountStart: discountStart || null,
    discountEnd: discountEnd || null,
    prevPrice: null, prevCost: null,
    updatedAt: new Date().toISOString(),
    ownerId: uid
  });
}

async function updateProduct(id, costStr, priceStr, discountPriceStr, discountStart, discountEnd){
  const cost = Number(costStr) || 0;
  const price = Number(priceStr) || 0;
  const old = products.find(p => p.id === id);
  if(!old) return;
  await db.collection('products').doc(id).update({
    prevPrice: old.price,
    prevCost: old.cost,
    cost, price,
    discountPrice: (discountPriceStr === '' || discountPriceStr === null || discountPriceStr === undefined) ? null : Number(discountPriceStr),
    discountStart: discountStart || null,
    discountEnd: discountEnd || null,
    updatedAt: new Date().toISOString()
  });
  expandedId = null;
  render();
  showToast('가격 업데이트 완료');
}

async function deleteProduct(id){
  await db.collection('products').doc(id).delete();
  expandedId = null;
  showToast('삭제 완료');
}

// ---- RENDER ----
function render(){
  const query = searchInput.value.trim().toLowerCase();
  const filtered = products
    .filter(p => p.name.toLowerCase().includes(query))
    .sort((a,b) => a.name.localeCompare(b.name, 'ko'));

  countLabel.textContent = products.length + '개 상품';

  if(filtered.length === 0){
    listEl.innerHTML = `<div class="empty">
      <b>${products.length === 0 ? '등록된 상품이 없어' : '검색 결과 없음'}</b>
      ${products.length === 0 ? '+ 버튼으로 첫 상품을 등록해봐' : '다른 검색어로 찾아봐'}
    </div>`;
    return;
  }

  listEl.innerHTML = filtered.map(p => renderCard(p)).join('');

  filtered.forEach(p => {
    const card = document.getElementById('card-' + p.id);
    card.addEventListener('click', (e) => {
      if(e.target.closest('.edit-panel')) return;
      expandedId = expandedId === p.id ? null : p.id;
      render();
    });
    if(expandedId === p.id){
      const costInput = document.getElementById('editCost-' + p.id);
      const priceInput = document.getElementById('editPrice-' + p.id);
      const discountPriceInput = document.getElementById('editDiscountPrice-' + p.id);
      const discountStartInput = document.getElementById('editDiscountStart-' + p.id);
      const discountEndInput = document.getElementById('editDiscountEnd-' + p.id);
      document.getElementById('saveEdit-' + p.id).addEventListener('click', (e) => {
        e.stopPropagation();
        updateProduct(p.id, costInput.value, priceInput.value, discountPriceInput.value, discountStartInput.value, discountEndInput.value);
      });
      document.getElementById('cancelEdit-' + p.id).addEventListener('click', (e) => {
        e.stopPropagation();
        expandedId = null;
        render();
      });
      document.getElementById('deleteBtn-' + p.id).addEventListener('click', (e) => {
        e.stopPropagation();
        deleteProduct(p.id);
      });
    }
  });
}

function renderCard(p){
  const margin = marginPct(p.cost, p.price);
  const marginClass = margin >= 0 ? 'pos' : 'neg';
  const isExpanded = expandedId === p.id;

  let diffHtml = '';
  if(p.prevCost !== null && p.prevCost !== undefined && p.prevCost !== p.cost){
    const diff = p.cost - p.prevCost;
    if(diff > 0){
      diffHtml = `<div class="diff-row"><span class="arrow-up">▲ +${fmt(diff)}원</span><span style="color:var(--ink-soft)">(이전 원가 ${fmt(p.prevCost)}원)</span></div>`;
    } else if(diff < 0){
      diffHtml = `<div class="diff-row"><span class="arrow-down">▼ ${fmt(diff)}원</span><span style="color:var(--ink-soft)">(이전 원가 ${fmt(p.prevCost)}원)</span></div>`;
    }
  } else if(p.prevCost === p.cost && p.prevCost !== null && p.prevCost !== undefined){
    diffHtml = `<div class="diff-row"><span class="no-change">- 원가 변동 없음</span></div>`;
  }

  const dStatus = discountStatus(p);
  let discountBlockHtml = '';
  let discountRowHtml = '';
  if(dStatus){
    const expiredClass = dStatus === 'expired' ? ' expired' : '';
    discountBlockHtml = `
      <div class="price-block discount${expiredClass}">
        <div class="label">할인가</div>
        <div class="value">${fmt(p.discountPrice)}</div>
      </div>`;
    const badgeLabel = dStatus === 'active' ? '할인중' : (dStatus === 'upcoming' ? '할인예정' : '할인종료');
    const dl = dStatus === 'active' ? daysLeft(p.discountEnd) : null;
    const dlText = (dl !== null && dl !== undefined) ? ` · D-${dl}` : '';
    discountRowHtml = `
      <div class="discount-row">
        <span class="discount-badge ${dStatus}">${badgeLabel}${dlText}</span>
        ${p.discountStart || p.discountEnd ? `<span class="discount-dates">${fmtDate(p.discountStart)}~${fmtDate(p.discountEnd)}</span>` : ''}
      </div>`;
  }

  return `
  <div class="tag" id="card-${p.id}">
    <div class="tag-top">
      <div class="tag-name">${escapeHtml(p.name)}</div>
      <div class="margin-badge ${marginClass}">마진 ${margin.toFixed(1)}%</div>
    </div>
    <div class="tag-prices">
      <div class="price-block">
        <div class="label">원가</div>
        <div class="value">${fmt(p.cost)}</div>
      </div>
      ${discountBlockHtml}
      <div class="price-block sell">
        <div class="label">판매가</div>
        <div class="value">${fmt(p.price)}</div>
      </div>
    </div>
    ${discountRowHtml}
    ${diffHtml}
    <div class="updated">${timeAgo(p.updatedAt)}</div>
    ${isExpanded ? `
    <div class="edit-panel">
      <div class="field">
        <label>원가 (원)</label>
        <input type="number" inputmode="numeric" id="editCost-${p.id}" value="${p.cost}">
      </div>
      <div class="field">
        <label>할인가 (원, 선택)</label>
        <input type="number" inputmode="numeric" id="editDiscountPrice-${p.id}" value="${p.discountPrice ?? ''}" placeholder="할인 없으면 비워둬">
      </div>
      <div style="display:flex; gap:10px;">
        <div class="field" style="flex:1;">
          <label>할인 시작일</label>
          <input type="date" id="editDiscountStart-${p.id}" value="${p.discountStart || ''}">
        </div>
        <div class="field" style="flex:1;">
          <label>할인 종료일</label>
          <input type="date" id="editDiscountEnd-${p.id}" value="${p.discountEnd || ''}">
        </div>
      </div>
      <div class="field">
        <label>판매가 (원)</label>
        <input type="number" inputmode="numeric" id="editPrice-${p.id}" value="${p.price}">
      </div>
      <div class="edit-actions">
        <button class="btn delete" id="deleteBtn-${p.id}">삭제</button>
        <button class="btn cancel" id="cancelEdit-${p.id}">취소</button>
        <button class="btn save" id="saveEdit-${p.id}">저장</button>
      </div>
    </div>` : ''}
  </div>`;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Events ----
searchInput.addEventListener('input', render);

document.getElementById('addBtn').addEventListener('click', () => {
  document.getElementById('newName').value = '';
  document.getElementById('newCost').value = '';
  document.getElementById('newPrice').value = '';
  document.getElementById('newDiscountPrice').value = '';
  document.getElementById('newDiscountStart').value = '';
  document.getElementById('newDiscountEnd').value = '';
  overlay.classList.add('show');
});
document.getElementById('cancelAdd').addEventListener('click', () => {
  overlay.classList.remove('show');
});
overlay.addEventListener('click', (e) => {
  if(e.target === overlay) overlay.classList.remove('show');
});
document.getElementById('saveAdd').addEventListener('click', async () => {
  const name = document.getElementById('newName').value.trim();
  const cost = Number(document.getElementById('newCost').value) || 0;
  const price = Number(document.getElementById('newPrice').value) || 0;
  const discountPrice = document.getElementById('newDiscountPrice').value;
  const discountStart = document.getElementById('newDiscountStart').value;
  const discountEnd = document.getElementById('newDiscountEnd').value;
  if(!name){
    showToast('상품명을 입력해줘');
    return;
  }
  await addProduct(name, cost, price, discountPrice, discountStart, discountEnd);
  overlay.classList.remove('show');
  showToast('상품 등록 완료');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(products, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'costco_products_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

// PWA install prompt
let deferredPrompt = null;
const installBanner = document.getElementById('installBanner');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBanner.classList.add('show');
});
document.getElementById('installBtn').addEventListener('click', async () => {
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBanner.classList.remove('show');
});
window.addEventListener('appinstalled', () => {
  installBanner.classList.remove('show');
});

// Service worker
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
