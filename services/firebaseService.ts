import { initializeApp } from 'firebase/app';
import { getDatabase, ref as dbRef, set, onValue, get } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { Project, AppSettings, ScratchTask, ActivityLog } from '../types';

export const USE_MULTI_TENANT = true;

const CONFIG_STORAGE_KEY = 'projectflow_firebase_config';
const DISCONNECT_FLAG_KEY = 'projectflow_manual_disconnect';
const ACCOUNT_ID = 'default_user';

// User provided configuration
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyDPFo1kN2hV1xK3a6lFeGXgUuUnJEfKGH4",
  authDomain: "projectflow-storage.firebaseapp.com",
  databaseURL: "https://projectflow-storage-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "projectflow-storage",
  storageBucket: "projectflow-storage.firebasestorage.app",
  messagingSenderId: "282501228704",
  appId: "1:282501228704:web:e0dae10ef3f6cd9b8b81c5",
  measurementId: "G-JCVTVXCS8T"
};

let db: any = null;
let storage: any = null;
let auth: any = null;
let currentUser: User | null = null;
let currentOrgId: string | null = null;
let isConfigured = false;

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
  const isManuallyDisconnected = localStorage.getItem(DISCONNECT_FLAG_KEY) === 'true';

  if (!isManuallyDisconnected) {
    // Check local storage first, otherwise use default
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    const config = saved ? parseConfig(saved) : DEFAULT_CONFIG;
    
    if (config && config.databaseURL) {
      const app = initializeApp(config);
      db = getDatabase(app);
      storage = getStorage(app);
      auth = getAuth(app);
      isConfigured = true;

      if (USE_MULTI_TENANT) {
        onAuthStateChanged(auth, async (user) => {
          currentUser = user;
          if (user) {
            const userRef = dbRef(db, `users/${user.uid}`);
            const userSnap = await get(userRef);
            if (userSnap.exists()) {
               currentOrgId = userSnap.val().orgId;
            } else {
               currentOrgId = null; // Needs to create/join org
            }
            window.dispatchEvent(new Event('firebase-auth-changed'));
          } else {
            currentOrgId = null;
            window.dispatchEvent(new Event('firebase-auth-changed'));
          }
        });
      }
    }
  }
} catch (e) {
  console.error("Firebase Initialization Error:", e);
}

export const firebaseService = {
  isConfigured: () => isConfigured,

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
      if (e.code === 'auth/unauthorized-domain') {
         console.log("Falling back to anonymous auth due to unauthorized domain");
         const anonResult = await signInAnonymously(auth);
         return anonResult.user;
      }
      throw e; // Rethrow to let the UI catch and display the error
    }
  },

  loginWithEmail: async (email: string, pass: string) => {
    if (!auth) return null;
    try {
      const result = await signInWithEmailAndPassword(auth, email, pass);
      return result.user;
    } catch (e: any) {
      console.error("Email login failed", e);
      throw e;
    }
  },

  signupWithEmail: async (email: string, pass: string) => {
    if (!auth) return null;
    try {
      const result = await createUserWithEmailAndPassword(auth, email, pass);
      return result.user;
    } catch (e: any) {
      console.error("Email signup failed", e);
      throw e;
    }
  },

  loginAnonymously: async () => {
    if (!auth) return null;
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (e: any) {
      console.error("Anonymous login failed", e);
      throw e;
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

  createOrganization: async (orgName: string) => {
    if (!currentUser || !db) return false;
    try {
      const newOrgId = `org_${Date.now()}`;
      const userRef = dbRef(db, `users/${currentUser.uid}`);
      await set(userRef, {
        email: currentUser.email,
        orgId: newOrgId,
        role: "admin"
      });
      await set(dbRef(db, `organizations/${newOrgId}`), {
        name: orgName,
        createdAt: Date.now()
      });
      currentOrgId = newOrgId;
      window.dispatchEvent(new Event('firebase-auth-changed'));
      return true;
    } catch (e) {
      console.error("Failed to create org", e);
      return false;
    }
  },

  migrateOldDataToOrganization: async (orgName: string) => {
    if (!currentUser || !db) return false;
    try {
      const newOrgId = `org_${Date.now()}`;
      const userRef = dbRef(db, `users/${currentUser.uid}`);
      await set(userRef, {
        email: currentUser.email,
        orgId: newOrgId,
        role: "admin"
      });
      await set(dbRef(db, `organizations/${newOrgId}`), {
        name: orgName,
        createdAt: Date.now()
      });
      currentOrgId = newOrgId;
      
      // Fetch data from legacy
      const legacyDataRef = dbRef(db, `accounts/${ACCOUNT_ID}/projectflow_v1`);
      const snapshot = await get(legacyDataRef);
      if (snapshot.exists()) {
         const data = snapshot.val();
         // Save to new org
         const dataRef = dbRef(db, `projects/${newOrgId}`);
         await set(dataRef, data);
      }
      
      window.dispatchEvent(new Event('firebase-auth-changed'));
      return true;
    } catch(e) {
      console.error("Failed to migrate data", e);
      return false;
    }
  },

  recoverLegacyData: async (targetOrg?: string) => {
    const org = targetOrg || currentOrgId;
    if (!currentUser || !db || !org) return false;
    try {
      const legacyDataRef = dbRef(db, `accounts/${ACCOUNT_ID}/projectflow_v1`);
      const snapshot = await get(legacyDataRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const dataRef = dbRef(db, `projects/${org}`);
        await set(dataRef, data);
        return true;
      }
      return false;
    } catch(e) {
      console.error("Failed to recover legacy data", e);
      return false;
    }
  },

  joinOrganization: async (orgId: string) => {
    if (!currentUser || !db) return false;
    try {
      const userRef = dbRef(db, `users/${currentUser.uid}`);
      await set(userRef, {
        email: currentUser.email,
        orgId: orgId,
        role: "member"
      });
      currentOrgId = orgId;
      window.dispatchEvent(new Event('firebase-auth-changed'));
      return true;
    } catch (e) {
      console.error("Failed to join org", e);
      return false;
    }
  },

  createInviteResultUrl: async (emailToInvite: string) => {
    if (!currentUser || !currentOrgId || !db) return null;
    try {
      const token = `token_${crypto.randomUUID()}`;
      await set(dbRef(db, `invites/${token}`), {
        orgId: currentOrgId,
        invitedBy: currentUser.uid,
        email: emailToInvite,
        createdAt: Date.now()
      });
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
      const inviteRef = dbRef(db, `invites/${token}`);
      const snap = await get(inviteRef);
      if (snap.exists()) {
         const { orgId } = snap.val();
         // Update user to be part of the org
         const userRef = dbRef(db, `users/${currentUser.uid}`);
         await set(userRef, {
           email: currentUser.email,
           orgId: orgId,
           role: "member"
         });
         currentOrgId = orgId;
         
         // Try to delete the invite token (clean up)
         try {
           await set(inviteRef, null);
         } catch(e) {
           console.warn("Could not delete invite token, permission denied?");
         }

         window.dispatchEvent(new Event('firebase-auth-changed'));
         return true;
      }
      return false;
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

    if (USE_MULTI_TENANT) {
      if (!currentUser || !currentOrgId) {
        callback(null);
        return () => {};
      }
      const dataRef = dbRef(db, `projects/${currentOrgId}`);
      return onValue(dataRef, 
        (snapshot) => {
          const data = snapshot.val();
          // Map backend multi-tenant format if necessary, or just return them
          // Here we assume mapping is needed or they're stored directly as the legacy structure inside `projects/${orgId}`
          // To make it easy, assume `projects/${orgId}` contains the same structure as legacy `projectflow_v1`
          callback(data);
        },
        (error) => {
          if (onError) onError(error);
        }
      );

    } else {
      const legacyDataRef = dbRef(db, 'projectflow_v1');
      const accountDataRef = dbRef(db, `accounts/${ACCOUNT_ID}/projectflow_v1`);

      // Run migration check without blocking the return of the unsubscribe function
      (async () => {
        try {
          const snap = await get(accountDataRef);
          if (!snap.exists()) {
            const legacySnap = await get(legacyDataRef);
            if (legacySnap.exists()) {
              await set(accountDataRef, legacySnap.val());
            }
          }
        } catch (e) {
          console.warn("Migration check failed", e);
        }
      })();

      return onValue(accountDataRef, 
        (snapshot) => {
          const data = snapshot.val();
          callback(data);
        },
        (error) => {
          if (onError) onError(error);
        }
      );
    }
  },

  save: async (data: { projects: Project[], settings: AppSettings, scratchTasks?: ScratchTask[], activityLogs?: ActivityLog[] }) => {
    if (!db) return;
    const cleanData = JSON.parse(JSON.stringify({
      projects: data.projects || [],
      settings: data.settings,
      scratchTasks: data.scratchTasks || [],
      activityLogs: data.activityLogs || [],
      lastUpdated: Date.now()
    }));

    if (USE_MULTI_TENANT) {
       if (!currentUser || !currentOrgId) return;
       const dataRef = dbRef(db, `projects/${currentOrgId}`);
       await set(dataRef, cleanData);
    } else {
       const dataRef = dbRef(db, `accounts/${ACCOUNT_ID}/projectflow_v1`);
       await set(dataRef, cleanData);
    }
  },

  uploadFile: async (file: Blob, name: string): Promise<string | null> => {
    if (!storage) {
      console.warn("Storage not initialized.");
      return null;
    }
    let fileRef;
    if (USE_MULTI_TENANT) {
      if (!currentUser || !currentOrgId) return null;
      fileRef = storageRef(storage, `organizations/${currentOrgId}/files/${name}`);
    } else {
      fileRef = storageRef(storage, `accounts/${ACCOUNT_ID}/files/${name}`);
    }
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
    let fileRef;
    if (USE_MULTI_TENANT) {
      if (!currentUser || !currentOrgId) return null;
      fileRef = storageRef(storage, `organizations/${currentOrgId}/recordings/${subtaskId}_${timestamp}.${ext}`);
    } else {
      fileRef = storageRef(storage, `accounts/${ACCOUNT_ID}/recordings/${subtaskId}_${timestamp}.${ext}`);
    }
    await uploadBytes(fileRef, file);
    return await getDownloadURL(fileRef);
  }
};