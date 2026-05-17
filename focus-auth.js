import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
  set
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const config = window.JAY_FIREBASE_CONFIG || {};
const configured = !!(
  config.apiKey &&
  config.authDomain &&
  config.projectId &&
  !String(config.apiKey).startsWith("PASTE_")
);

function publicUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email || "",
    name: user.displayName || user.email?.split("@")[0] || "User",
    mode: "firebase",
    signedIn: true
  };
}

window.JayFirebaseAuth = {
  enabled: configured,
  currentUser: null,
  async signUp(email, password, name) {
    if (!configured) throw new Error("Firebase is not configured yet.");
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(credential.user, { displayName: name });
    return publicUser(credential.user);
  },
  async signIn(email, password) {
    if (!configured) throw new Error("Firebase is not configured yet.");
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return publicUser(credential.user);
  },
  async resetPassword(email) {
    if (!configured) throw new Error("Firebase is not configured yet.");
    await sendPasswordResetEmail(auth, email);
  },
  async signOut() {
    if (!configured) return;
    await signOut(auth);
  },
  async loadState(uid) {
    if (!configured || !db || !uid) return null;
    const snapshot = await get(ref(db, `users/${uid}/plannerState`));
    return snapshot.exists() ? snapshot.val()?.state || null : null;
  },
  async saveState(uid, state) {
    if (!configured || !db || !uid || !state) return;
    await set(ref(db, `users/${uid}/plannerState`), {
      state,
      updatedAt: Date.now(),
      version: 1
    });
  },
  subscribeToState(uid, callback) {
    if (!configured || !db || !uid || typeof callback !== "function") return () => {};
    const stateRef = ref(db, `users/${uid}/plannerState`);
    return onValue(stateRef, snapshot => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      const val = snapshot.val();
      callback(val?.state || null);
    });
  }
};

let auth = null;
let db = null;
if (configured) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app, config.databaseURL);
  onAuthStateChanged(auth, user => {
    const next = publicUser(user);
    window.JayFirebaseAuth.currentUser = next;
    document.dispatchEvent(new CustomEvent("jay-auth-state", { detail: next }));
  });
} else {
  document.dispatchEvent(new CustomEvent("jay-auth-unconfigured"));
}
