/**
 * auth.js — AIO Inventory user authentication & role management
 * Sign-in is Microsoft Entra ID (via the Firebase Auth "microsoft.com" OAuth
 * provider). Roles live in the Firestore `users/<uid>` doc: { name, email, role }.
 *
 * Email/password still exists for ONE break-glass admin account, reachable only
 * from the unlisted ?signin=fallback URL — see ENTRA-SETUP.md.
 */

// ── Entra tenant ─────────────────────────────────────────────────────────
// The AIO Entra (Azure AD) tenant/directory ID. Restricts the Microsoft sign-in
// to accounts in this tenant. See ENTRA-SETUP.md step 1 for where to find it.
const ENTRA_TENANT_ID = 'e951f5b3-da6a-4b3d-9f40-993a88995573';

const Auth = (() => {

  let _currentUser  = null;  // Firebase Auth user
  let _userProfile  = null;  // Firestore user doc { name, email, role }
  let _onAuthReady  = [];
  let _authReady    = false;
  let _redirectError = null;  // a failed redirect never reaches onAuthStateChanged

  const FB_CONFIG = {
    apiKey:            "AIzaSyCwlZg9YaGfQDKuVBDI4RAkEzKcDg7Cgdo",
    authDomain:        "aioinventory.vercel.app",
    projectId:         "aio-inventory-b9b29",
    storageBucket:     "aio-inventory-b9b29.firebasestorage.app",
    messagingSenderId: "146229036238",
    appId:             "1:146229036238:web:c91467e73e3e2912683c9f"
  };

  // ── Initialise ──────────────────────────────────────────────────────────
  async function init() {
    const { getAuth, onAuthStateChanged, signOut: fbSignOut, getRedirectResult } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { initializeApp, getApps } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');

    const app  = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
    const auth = getAuth(app);
    const db   = fs.getFirestore(app);

    // If we came back from the redirect fallback and it failed, this is the only
    // place the error surfaces — onAuthStateChanged just reports "signed out".
    try { await getRedirectResult(auth); } catch(e) { _redirectError = e; }

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        _currentUser = user;
        let revoked = false;
        try {
          const res = await _resolveProfile(db, fs, user);
          if (res.revoked) revoked = true; else _userProfile = res.profile;
        } catch(e) {
          // Never lock someone out on an unexpected error — degrade to view only
          _userProfile = { name: user.displayName || user.email, email: user.email, role: 'view' };
        }
        if (revoked) {
          // Access removed by an admin — bounce straight back to the login screen
          _currentUser = null;
          _userProfile = null;
          await fbSignOut(auth);
          return;
        }
        _authReady = true;
        _onAuthReady.forEach(fn => fn(true));
        _onAuthReady = [];
      } else {
        _currentUser = null;
        _userProfile = null;
        _authReady   = true;
        _onAuthReady.forEach(fn => fn(false));
        _onAuthReady = [];
      }
    });
  }

  // ── Work out which profile this signed-in user gets ──────────────────────
  // 1. users/<uid> already exists           → use it
  // 2. a legacy profile with the same email → lazily join it onto this uid
  // 3. an admin pre-assigned a role by email → use that role
  // 4. otherwise                            → brand new view-only account
  async function _resolveProfile(db, fs, user) {
    const ref  = fs.doc(db, 'users', user.uid);
    const snap = await fs.getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();
      if (data.deleted) return { revoked: true };
      return { profile: data };
    }

    const email     = user.email || '';
    const fallback  = user.displayName || email;
    const now       = new Date().toISOString();

    const legacy = await _findProfileByEmail(db, fs, email, user.uid);
    if (legacy) {
      if (legacy.deleted) return { revoked: true };
      const profile = {
        name:      legacy.name || fallback,
        email,
        role:      legacy.role || 'view',
        createdAt: legacy.createdAt || now,
        joinedFrom: legacy.id,
        joinedAt:  now,
      };
      await _writeProfile(fs, ref, profile);
      // Retire the old doc so the user isn't listed twice
      try { await fs.updateDoc(fs.doc(db, 'users', legacy.id), { migratedTo: user.uid, migratedAt: now }); } catch(_) {}
      return { profile };
    }

    const pending = await _pendingFor(email);
    if (pending) {
      const profile = { name: pending.name || fallback, email, role: pending.role || 'view', createdAt: now };
      await _writeProfile(fs, ref, profile);
      if (typeof DB !== 'undefined') DB.removePendingUser(email);
      return { profile };
    }

    const profile = { name: fallback, email, role: 'view', createdAt: now };
    await _writeProfile(fs, ref, profile);
    return { profile };
  }

  // Scan the users collection for a profile with this email under a different
  // uid — a password-era account being joined to its Entra identity. If the
  // rules don't allow listing users this returns null and the caller falls
  // through to a view-only account for an admin to correct.
  async function _findProfileByEmail(db, fs, email, uid) {
    if (!email) return null;
    const want = email.toLowerCase();
    try {
      const snap = await fs.getDocs(fs.collection(db, 'users'));
      const hit  = snap.docs.find(d =>
        d.id !== uid &&
        !d.data().migratedTo &&
        String(d.data().email || '').toLowerCase() === want);
      return hit ? { id: hit.id, ...hit.data() } : null;
    } catch(e) {
      return null;
    }
  }

  // Pre-assigned roles live in the main inventory doc, so wait for DB
  function _pendingFor(email) {
    return new Promise(resolve => {
      if (typeof DB === 'undefined' || !email) return resolve(null);
      DB.onReady(() => resolve(DB.getPendingUser(email)));
    });
  }

  async function _writeProfile(fs, ref, profile) {
    try { await fs.setDoc(ref, profile); } catch(_) {}  // in-memory profile still works
  }

  function onReady(fn) {
    if (_authReady) fn(!!_currentUser); else _onAuthReady.push(fn);
  }

  function getRedirectError() { return _redirectError; }
  function getUser()    { return _currentUser; }
  function getProfile() { return _userProfile; }
  function isAdmin()    { return _userProfile?.role === 'admin'; }
  function canEdit()    { return _userProfile?.role === 'admin' || _userProfile?.role === 'edit'; }
  function getName()    { return _userProfile?.name || _currentUser?.email || ''; }

  // ── Microsoft Entra ID sign-in ──────────────────────────────────────────
  // Safari never completes the popup handshake — the window opens, the account
  // is picked, and the credential never reaches the opener, so the SDK reports
  // auth/popup-closed-by-user. Send WebKit straight down the redirect path,
  // which works because /__/auth is served from this origin (see vercel.json).
  function prefersRedirect() {
    const ua = navigator.userAgent;
    const iOS    = /iP(hone|ad|od)/.test(ua) ||
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg|android/i.test(ua);
    return iOS || safari;
  }

  async function signInWithMicrosoft() {
    const { getAuth, OAuthProvider, signInWithPopup, signInWithRedirect } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

    const provider = new OAuthProvider('microsoft.com');
    provider.setCustomParameters({ tenant: ENTRA_TENANT_ID, prompt: 'select_account' });

    if (prefersRedirect()) {
      await signInWithRedirect(getAuth(), provider);
      return;
    }

    try {
      await signInWithPopup(getAuth(), provider);
    } catch(e) {
      // Managed browsers often block popups outright — fall back to a redirect
      if (e.code === 'auth/popup-blocked' ||
          e.code === 'auth/popup-closed-by-user' ||
          e.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(getAuth(), provider);
        return;
      }
      throw e;
    }
  }

  // Break-glass only — see ENTRA-SETUP.md
  async function signIn(email, password) {
    const { getAuth, signInWithEmailAndPassword } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await signInWithEmailAndPassword(getAuth(), email, password);
  }

  async function signOut() {
    const { getAuth, signOut: fbSignOut } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await fbSignOut(getAuth());
    window.location.reload();
  }

  return { init, onReady, getUser, getProfile, isAdmin, canEdit, getName, getRedirectError, signInWithMicrosoft, signIn, signOut };
})();

// ── User Management (admin only) ──────────────────────────────────────────
const UserManager = (() => {

  async function listUsers() {
    const { getFirestore, collection, getDocs } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db = getFirestore();
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => !u.migratedTo);   // superseded by the user's Entra profile
  }

  async function updateUserRole(uid, role) {
    const { getFirestore, doc, updateDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(getFirestore(), 'users', uid), { role });
  }

  async function deleteUser(uid) {
    // Soft-delete: the profile stays so the same person signing in again with
    // Entra is refused rather than silently handed a fresh view-only account.
    const { getFirestore, doc, updateDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(getFirestore(), 'users', uid), {
      deleted: true,
      deletedAt: new Date().toISOString(),
    });
  }

  async function reactivateUser(uid, name, role) {
    const { getFirestore, doc, updateDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(getFirestore(), 'users', uid), {
      name, role,
      deleted: false,
      deletedAt: null,
      reactivatedAt: new Date().toISOString(),
    });
  }

  function addPendingUser(email, name, role) {
    // Stored in DB (inventory/main). On their first Entra sign-in this is what
    // gives them a role other than view-only.
    DB.setPendingUser(email, name, role);
  }

  return { listUsers, addPendingUser, updateUserRole, deleteUser, reactivateUser };
})();

// Start auth immediately
Auth.init();
