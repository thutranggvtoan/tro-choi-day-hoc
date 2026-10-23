// sync.js
// Đăng nhập Google và đồng bộ bộ đề với Firestore, dùng chung cho các trò trắc nghiệm.
// Dữ liệu nằm ở: artifacts/{APP_ID}/users/{uid}/quizzes/{id}
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { FIREBASE_CONFIG, APP_ID } from "./firebase-config.js";

const COLL = 'quizzes';
const statusListeners = [];
const dataListeners = [];
let lastStatus = { state: 'nocfg' };
let db = null;
let auth = null;
let userId = null;
let unsubscribe = null;

function emitStatus(s) {
  lastStatus = s;
  statusListeners.forEach(f => { try { f(s); } catch (e) { console.error(e); } });
}

function reportError(e, what) {
  console.error(what, e);
  emitStatus({ state: 'error', code: (e && e.code) || 'unknown', email: auth && auth.currentUser ? auth.currentUser.email : '' });
}

function startListening() {
  if (!db || !userId) return;
  if (unsubscribe) unsubscribe();
  const ref = collection(db, 'artifacts', APP_ID, 'users', userId, COLL);
  const uid = userId;
  unsubscribe = onSnapshot(
    ref,
    snap => {
      const list = [];
      snap.forEach(d => list.push(d.data()));
      if (lastStatus.state === 'error') emitStatus({ state: 'in', email: auth.currentUser ? auth.currentUser.email : '' });
      dataListeners.forEach(f => { try { f(list, uid); } catch (e) { console.error(e); } });
    },
    err => reportError(err, 'Lỗi đồng bộ')
  );
}

try {
  const app = initializeApp(FIREBASE_CONFIG);
  db = getFirestore(app);
  auth = getAuth(app);
  getRedirectResult(auth).catch(() => {});
  emitStatus({ state: 'out' });
  onAuthStateChanged(auth, user => {
    if (user) {
      userId = user.uid;
      emitStatus({ state: 'in', email: user.email || '' });
      startListening();
    } else {
      userId = null;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      emitStatus({ state: 'out' });
    }
  });
} catch (e) {
  console.error('Không khởi tạo được Firebase', e);
  emitStatus({ state: 'nocfg' });
}

export const sync = {
  /** Gọi cb ngay với trạng thái hiện tại, sau đó mỗi khi trạng thái đổi. */
  onStatus(cb) { statusListeners.push(cb); cb(lastStatus); },
  /** cb(danhSachBoDe, uid) được gọi mỗi khi dữ liệu trên đám mây thay đổi. */
  onData(cb) { dataListeners.push(cb); },
  get signedIn() { return !!userId; },

  async save(set) {
    if (!db || !userId) return;
    try {
      await setDoc(doc(db, 'artifacts', APP_ID, 'users', userId, COLL, String(set.id)), set);
    } catch (e) { reportError(e, 'Lỗi lưu'); }
  },

  async remove(id) {
    if (!db || !userId) return;
    try {
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'users', userId, COLL, String(id)));
    } catch (e) { reportError(e, 'Lỗi xóa'); }
  },

  async toggleAuth() {
    if (!auth) return;
    if (auth.currentUser) { await signOut(auth); return; }
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        alert('Không đăng nhập được: ' + e.message +
          '\n\nHãy kiểm tra tên miền của trang web đã được thêm vào mục Authorized domains trong Firebase Authentication chưa.');
      }
    }
  },
};
