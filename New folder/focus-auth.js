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
  }
};

let auth = null;
if (configured) {
  const app = initializeApp(config);
  auth = getAuth(app);
  onAuthStateChanged(auth, user => {
    const next = publicUser(user);
    window.JayFirebaseAuth.currentUser = next;
    document.dispatchEvent(new CustomEvent("jay-auth-state", { detail: next }));
  });
} else {
  document.dispatchEvent(new CustomEvent("jay-auth-unconfigured"));
}
