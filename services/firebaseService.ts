import { initializeApp } from 'firebase/app';
import { getDatabase, ref as dbRef, onValue, get, runTransaction } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { Project, AppSettings, ScratchTask, ActivityLog } from '../types';
import { projectCollectionsShareRevisions } from '../lib/projectRevisionGuard';

const CONFIG_STORAGE_KEY = 'hyperflow_firebase_config';
const LEGACY_CONFIG_STORAGE_KEY = 'projectflow_firebase_config';
const DISCONNECT_FLAG_KEY = 'hyperflow_manual_disconnect';
const LEGACY_DISCONNECT_FLAG_KEY = 'projectflow_manual_disconnect';
/**
 * The Firebase project this app talks to.
 *
 * A Firebase *web* config is not a secret — it ships to every visitor inside the
 * bundle no matter how it is supplied, and Firebase's own guidance is that
 * security comes from Security Rules (see database.rules.json), not from hiding
 * these values. So the working default lives here, and the app connects with no
 * setup.
 *
 * VITE_FIREBASE_* overrides it at build time so a deployment can point at a
 * different project, and a config pasted into Cloud Setup overrides both at
 * runtime. The service-account key used by the server is a real secret and is
 * never part of this — it stays in FIREBASE_SERVICE_ACCOUNT.
 */
export const HYPERFLOW_DATABASE_URL =
  'https://hyper-flow-a459b-default-rtdb.asia-southeast1.firebasedatabase.app';

const BUILTIN_CONFIG = {
  apiKey: 'AIzaSyByMTn8MZAEgwn2MpFLgVe9EeWHeK4ECnM',
  authDomain: 'hyper-flow-a459b.firebaseapp.com',
  databaseURL: HYPERFLOW_DATABASE_URL,
  projectId: 'hyper-flow-a459b',
  storageBucket: 'hyper-flow-a459b.firebasestorage.app',
  messagingSenderId: '866115549453',
  appId: '1:866115549453:web:55c189ba8ef0c089899844',
  measurementId: 'G-F4QD08N25F'
};

const viteEnv: Record<string, string | undefined> = ((import.meta as any)?.env) || {};

/**
 * An env override needs at least an API key, project id and database URL to be
 * usable; authDomain and storageBucket follow Firebase's naming convention when
 * omitted. A partial override is ignored rather than merged, so a half-set
 * environment cannot produce a config pointing at two different projects.
 */
const buildEnvConfig = () => {
  const projectId = viteEnv.VITE_FIREBASE_PROJECT_ID;
  const apiKey = viteEnv.VITE_FIREBASE_API_KEY;
  const databaseURL = viteEnv.VITE_FIREBASE_DATABASE_URL;

  if (!projectId || !apiKey || !databaseURL) return null;

  return {
    apiKey,
    projectId,
    databaseURL,
    authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: viteEnv.VITE_FIREBASE_APP_ID,
    measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID
  };
};

const DEFAULT_CONFIG = buildEnvConfig() || BUILTIN_CONFIG;

let db: any = null;
let storage: any = null;
let auth: any = null;
let currentUser: User | null = null;
let currentOrgId: string | null = null;
let isConfigured = false;
let currentDataRevision = 0;

// specific parsing to handle the user pasting the raw JS object from Firebase console
const parseConfig = (raw: string | null) => {
  if (!raw) return null;
  
  // 1. Try strict JSON parse first (fastest/safest)
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 2. If JSON fails, assume it's a JavaScript Object Literal (e.g. copied from code)
    try {
      // Remove comments (single line // and multi-line /* */)
      // This is crucial because { ... } might contain comments which new Function handles, 
      // but if the braces are commented out, we need to know.
      // Also, finding the first '{' is safer if comments are removed.
      const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
         return null;
      }
      
      // Extract just the object literal part: { key: "value", ... }
      const objectLiteral = cleaned.substring(firstBrace, lastBrace + 1);
      
      // Use Function constructor to parse the JS object literal.
      // This natively handles:
      // - Trailing commas
      // - Unquoted keys
      // - Single vs Double quotes
      // - Whitespace
      // Note: We use the cleaned string to ensure no malicious code outside the braces runs,
      // though inside the braces code execution is still possible (e.g. { a: (()=>{})() }).
      // Given this is a user-configuration input for their own local app, this is acceptable.
      const fn = new Function('return ' + objectLiteral);
      return fn();
    } catch (e2) {
      console.error("Config parsing failed:", e2);
      return null;
    }
  }
};

try {
  // Check if manually disconnected to prevent auto-reconnect loop
  const isManuallyDisconnected = (localStorage.getItem(DISCONNECT_FLAG_KEY) || localStorage.getItem(LEGACY_DISCONNECT_FLAG_KEY)) === 'true';

  if (!isManuallyDisconnected) {
    // A config pasted into the Cloud Setup modal overrides the build's env config.
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY) || localStorage.getItem(LEGACY_CONFIG_STORAGE_KEY);
    if (saved && !localStorage.getItem(CONFIG_STORAGE_KEY)) localStorage.setItem(CONFIG_STORAGE_KEY, saved);
    const config = saved ? parseConfig(saved) : DEFAULT_CONFIG;

    if (!config?.databaseURL) {
      console.warn(
        'Firebase is not configured — running in local-only mode. Set VITE_FIREBASE_API_KEY, ' +
        'VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_DATABASE_URL, or paste a config in Cloud Setup.'
      );
    }

    if (config && config.databaseURL) {
      const app = initializeApp(config);
      db = getDatabase(app);
      storage = getStorage(app);
      auth = getAuth(app);
      isConfigured = true;

      onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
          const userRef = dbRef(db, `users/${user.uid}`);
          const userSnap = await get(userRef);
          if (userSnap.exists()) {
             currentOrgId = userSnap.val().orgId;
          } else {
             currentOrgId = null; // Needs to create or accept an organization invite.
          }
        } else {
          currentOrgId = null;
        }
        window.dispatchEvent(new Event('firebase-auth-changed'));
      });
    }
  }
} catch (e) {
  console.error("Firebase Initialization Error:", e);
}

/**
 * Turns a Firebase auth error code into something that names the actual cause
 * and where to fix it. These codes almost always mean the Firebase project is
 * missing configuration, not that the user did anything wrong — and the raw
 * message ("admin-restricted-operation") gives no hint which setting is at fault.
 */
export const describeAuthError = (e: any): Error => {
  const projectId = DEFAULT_CONFIG?.projectId || 'your Firebase project';
  const domain = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

  const detail = ((): string | null => {
    switch (e?.code) {
      case 'auth/unauthorized-domain':
        return `"${domain}" is not an authorised domain on Firebase project "${projectId}". ` +
               `Add it under Authentication → Settings → Authorized domains.`;
      case 'auth/admin-restricted-operation':
        return `Anonymous sign-in is disabled on Firebase project "${projectId}". ` +
               `Enable it under Authentication → Sign-in method, or use another sign-in option.`;
      case 'auth/operation-not-allowed':
        return `That sign-in method is not enabled on Firebase project "${projectId}". ` +
               `Enable it under Authentication → Sign-in method.`;
      case 'auth/popup-blocked':
        return 'The sign-in popup was blocked by the browser. Allow popups for this site and try again.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'The sign-in popup closed before completing.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'That email and password combination was not recognised.';
      case 'auth/email-already-in-use':
        return 'An account already exists for that email — sign in instead of registering.';
      case 'auth/network-request-failed':
        return 'Could not reach Firebase. Check the network connection and try again.';
      default:
        return null;
    }
  })();

  const err = new Error(detail || e?.message || 'Sign-in failed.');
  (err as any).code = e?.code;
  return err;
};

export const firebaseService = {
  isConfigured: () => isConfigured,
  getProjectId: () => DEFAULT_CONFIG?.projectId,

  configure: (configString: string) => {
    const config = parseConfig(configString);
    if (config && config.databaseURL) {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
      localStorage.removeItem(DISCONNECT_FLAG_KEY); // Clear manual disconnect flag
      window.location.reload();
      return true;
    }
    return false;
  },

  disconnect: () => {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
    localStorage.setItem(DISCONNECT_FLAG_KEY, 'true'); // Set manual disconnect flag
    window.location.reload();
  },

  loginWithGoogle: async () => {
    if (!auth) return null;
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      console.log("Logged in as:", result.user.email);
      return result.user;
    } catch (e: any) {
      console.error("Login failed:", e);
      // This used to silently retry as an anonymous sign-in when the domain was
      // unauthorised. If anonymous sign-in was also unavailable the user was
      // shown *that* failure instead — an error from an operation they never
      // asked for, pointing at the wrong cause. Report what actually failed.
      throw describeAuthError(e);
    }
  },

  loginWithEmail: async (email: string, pass: string) => {
    if (!auth) return null;
    try {
      const result = await signInWithEmailAndPassword(auth, email, pass);
      return result.user;
    } catch (e: any) {
      console.error("Email login failed", e);
      throw describeAuthError(e);
    }
  },

  signupWithEmail: async (email: string, pass: string) => {
    if (!auth) return null;
    try {
      const result = await createUserWithEmailAndPassword(auth, email, pass);
      return result.user;
    } catch (e: any) {
      console.error("Email signup failed", e);
      throw describeAuthError(e);
    }
  },

  loginAnonymously: async () => {
    if (!auth) return null;
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (e: any) {
      console.error("Anonymous login failed", e);
      throw describeAuthError(e);
    }
  },

  logout: async () => {
    if (!auth) return;
    try {
      await auth.signOut();
    } catch (e) {
      console.error("Logout failed:", e);
    }
  },

  getCurrentUser: () => currentUser,
  getCurrentOrgId: () => currentOrgId,
  getDataRevision: () => currentDataRevision,

  authorizedFetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!currentUser) throw new Error('Sign in is required');
    const token = await currentUser.getIdToken();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  },

  createOrganization: async (orgName: string) => {
    if (!currentUser || !db) return false;
    try {
      const response = await firebaseService.authorizedFetch('/api/organizations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Organization creation failed');
      currentOrgId = result.orgId;
      window.dispatchEvent(new Event('firebase-auth-changed'));
      return true;
    } catch (e) {
      console.error("Failed to create org", e);
      return false;
    }
  },

  createInviteResultUrl: async (emailToInvite: string) => {
    if (!currentUser || !currentOrgId || !db) return null;
    try {
      const response = await firebaseService.authorizedFetch('/api/invites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToInvite })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Invite creation failed');
      const token = result.token;
      // Return a full URL that points to our domain with ?token=
      const url = new URL(window.location.href);
      url.searchParams.set('token', token);
      return url.toString();
    } catch (e) {
      console.error("Failed to create invite", e);
      return null;
    }
  },

  consumeInviteToken: async (token: string) => {
    if (!currentUser || !db) return false;
    try {
      const response = await firebaseService.authorizedFetch('/api/invites/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Invite could not be accepted');
      currentOrgId = result.orgId;
      window.dispatchEvent(new Event('firebase-auth-changed'));
      return true;
    } catch (e) {
       console.error("Failed to consume invite token", e);
       return false;
    }
  },

  subscribe: (
    callback: (data: { projects: Project[], settings: AppSettings, scratchTasks?: ScratchTask[], activityLogs?: ActivityLog[], lastUpdated?: number } | null) => void,
    onError?: (error: Error) => void
  ) => {
    if (!db) return () => {};

    if (!currentUser || !currentOrgId) {
      callback(null);
      return () => {};
    }
    const dataRef = dbRef(db, `projects/${currentOrgId}`);
    return onValue(dataRef,
      (snapshot) => {
        const data = snapshot.val();
        currentDataRevision = Number(data?.dataRevision || 0);
        callback(data);
      },
      (error) => {
        if (onError) onError(error);
      }
    );
  },

  save: async (
    data: { projects: Project[], settings: AppSettings, scratchTasks?: ScratchTask[], activityLogs?: ActivityLog[] },
    scheduledAtRevision = currentDataRevision
  ) => {
    if (!db) return;
    const cleanData = JSON.parse(JSON.stringify({
      projects: data.projects || [],
      settings: data.settings,
      scratchTasks: data.scratchTasks || [],
      activityLogs: data.activityLogs || [],
      lastUpdated: Date.now()
    }));

    if (!currentUser || !currentOrgId) return;
    const dataRef = dbRef(db, `projects/${currentOrgId}`);
    const expectedRevision = scheduledAtRevision;
    const result = await runTransaction(dataRef, current => {
      const remoteRevision = Number(current?.dataRevision || 0);
      if (
        remoteRevision !== expectedRevision
        || !projectCollectionsShareRevisions(current?.projects, cleanData.projects)
      ) return;
      return {
        ...(current || {}),
        ...cleanData,
        projects: cleanData.projects.map((project: Project) => ({
          ...project,
          revision: Number(project.revision || 0) + 1
        })),
        dataRevision: remoteRevision + 1
      };
    }, { applyLocally: false });
    if (!result.committed) throw new Error('Cloud data changed while saving. The latest version has been loaded; review and retry your edit.');
    currentDataRevision = Number(result.snapshot.val()?.dataRevision || expectedRevision + 1);
  },

  uploadFile: async (file: Blob, name: string): Promise<string | null> => {
    if (!storage) {
      console.warn("Storage not initialized.");
      return null;
    }
    if (!currentUser || !currentOrgId) return null;
    const fileRef = storageRef(storage, `organizations/${currentOrgId}/files/${name}`);
    await uploadBytes(fileRef, file);
    return await getDownloadURL(fileRef);
  },

  uploadRecording: async (file: Blob, subtaskId: string): Promise<string | null> => {
    if (!storage) {
      console.warn("Storage not initialized.");
      return null;
    }
    const ext = file.type.includes('video') ? 'webm' : (file.type.includes('audio') ? 'webm' : 'bin');
    const timestamp = Date.now();
    if (!currentUser || !currentOrgId) return null;
    const fileRef = storageRef(storage, `organizations/${currentOrgId}/recordings/${subtaskId}_${timestamp}.${ext}`);
    await uploadBytes(fileRef, file);
    return await getDownloadURL(fileRef);
  }
};
