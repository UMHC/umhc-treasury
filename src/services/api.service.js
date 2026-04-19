// src/services/api.service.js

import store from "../core/state.js";

// Map<string, { promise: Promise, cancel: Function }>
const activeRequests = new Map();
const MAX_ACTIVE_REQUESTS = 100;

// Set<string> - Tracks IDs of requests that are currently triggering the loading state
const loadingRequests = new Set();
let callbackCounter = 0;

const SESSION_ID_KEY = "umhc_treasurer_session_id";
const SESSION_KEY_KEY = "umhc_treasurer_session_key";
const READ_ONLY_MESSAGE =
  "View-only mode: this action is only available with the full-access passkey.";

/*
 * SECURITY NOTE:
 * This application uses JSONP to communicate with Google Apps Script.
 * JSONP requires a global callback function, and we cannot use HttpOnly cookies
 * for session management because the script tag mechanism does not support them
 * in this context.
 *
 * We store the session key in sessionStorage to persist login across reloads.
 * This does expose the key to potential XSS attacks (if an attacker can execute JS).
 * To mitigate this:
 * 1. We strictly control the script URL.
 * 2. We use unique callbacks and clean them up immediately.
 * 3. We sanitize input parameters where possible.
 *
 * Future improvement: If higher security is required, consider moving to a
 * proxy server that can handle proper OAuth2/JWT flows, eliminating JSONP.
 */

// Private variables to hold session credentials
let _sessionId = null;
let _sessionKey = null;

// Once a session is established, the script URL is locked in memory so that
// mid-session localStorage tampering cannot redirect API calls to a different endpoint.
let _lockedScriptUrl = null;

const _validateScriptUrl = (raw) => {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.hostname !== "script.google.com" ||
      !parsed.pathname.startsWith("/macros/s/")
    ) {
      return null;
    }
  } catch (_) {
    return null;
  }
  return raw;
};

const getScriptUrl = () => {
  if (_lockedScriptUrl) return _lockedScriptUrl;
  return _validateScriptUrl(localStorage.getItem("script_url"));
};

const setScriptUrl = (url) => {
  if (url) {
    const trimmed = String(url).trim();
    localStorage.setItem("script_url", trimmed);
    _lockedScriptUrl = _validateScriptUrl(trimmed); // lock in memory immediately
  } else {
    localStorage.removeItem("script_url");
    _lockedScriptUrl = null;
  }
};

const hasScriptUrl = () => !!getScriptUrl();

/**
 * Initialize session from storage.
 * Should be called on app startup.
 */
const initSession = () => {
  _sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  _sessionKey = sessionStorage.getItem(SESSION_KEY_KEY);
  // Lock the URL at page load regardless of session state. This prevents a
  // browser extension (or other code) from swapping localStorage between the
  // user saving the URL and submitting their passkey.
  _lockedScriptUrl = _validateScriptUrl(localStorage.getItem("script_url"));
};

// Initialize immediately
initSession();

const setSession = (sessionId, sessionKey) => {
  _sessionId = sessionId;
  _sessionKey = sessionKey;
  // Only lock the URL if it isn't already locked. The common path sets it at
  // page load (initSession) or when the user explicitly saves a URL
  // (setScriptUrl). The fallback here covers logout → re-login without a page
  // reload, where clearSession() has nulled _lockedScriptUrl.
  if (!_lockedScriptUrl) {
    _lockedScriptUrl = _validateScriptUrl(localStorage.getItem("script_url"));
  }
  if (sessionId) sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  else sessionStorage.removeItem(SESSION_ID_KEY);

  if (sessionKey) sessionStorage.setItem(SESSION_KEY_KEY, sessionKey);
  else sessionStorage.removeItem(SESSION_KEY_KEY);
};

const clearSession = () => {
  _sessionId = null;
  _sessionKey = null;
  _lockedScriptUrl = null;
  sessionStorage.removeItem(SESSION_ID_KEY);
  sessionStorage.removeItem(SESSION_KEY_KEY);
};

const hasSession = () => !!_sessionId && !!_sessionKey;

const updateLoadingState = () => {
  store.setState("isLoading", loadingRequests.size > 0);
};

const rejectIfReadOnly = () => {
  const currentUser = store.getState("currentUser");
  if (currentUser && currentUser.loggedIn && currentUser.canEdit === false) {
    return Promise.reject(new Error(READ_ONLY_MESSAGE));
  }
  return null;
};

const requestMutating = (action, params = {}, options = {}) => {
  const rejected = rejectIfReadOnly();
  if (rejected) return rejected;
  return request(action, params, options);
};

/**
 * Performs a JSONP request to the Google Apps Script backend.
 * This function is a Promisified version of the old jsonpRequest,
 * and it includes the request de-duplication logic.
 *
 * @param {string} action - The backend action to perform.
 * @param {object} params - The parameters for the action.
 * @param {object} options - Request options (e.g., { skipLoading: true }).
 * @returns {Promise<any>} - A promise that resolves with the response data.
 */
const request = (action, params = {}, options = {}) => {
  const SCRIPT_URL = getScriptUrl();
  if (!SCRIPT_URL) {
    return Promise.reject(new Error("Script URL is not configured."));
  }

  let signingKey;
  // Use local variable instead of store
  const sessionId = _sessionId;

  if (action === "login") {
    signingKey = options.apiKey;
  } else {
    // Use local variable instead of store
    signingKey = _sessionKey;
  }

  if (!signingKey) {
    return Promise.reject(new Error("Authentication credentials not found."));
  }

  // Include sessionId in params if it exists and action is not login
  const finalParams = { ...params };
  if (action !== "login" && sessionId) {
    finalParams.sessionId = sessionId;
  }

  const sortedParams = {};
  Object.keys(finalParams)
    .sort()
    .forEach((key) => {
      const value = finalParams[key];
      sortedParams[key] =
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value);
    });

  const requestKey = `${action}-${JSON.stringify(sortedParams)}`;

  if (activeRequests.has(requestKey)) {
    return activeRequests.get(requestKey).promise;
  }

  // Safeguard against unbounded growth - check BEFORE adding
  if (activeRequests.size >= MAX_ACTIVE_REQUESTS) {
    const firstKey = activeRequests.keys().next().value;
    const oldestRequest = activeRequests.get(firstKey);
    if (oldestRequest && typeof oldestRequest.cancel === "function") {
      oldestRequest.cancel();
    }
    activeRequests.delete(firstKey);
    console.warn(
      `Request queue full. Oldest request (${firstKey}) cancelled and removed.`,
    );
  }

  if (!options.skipLoading) {
    loadingRequests.add(requestKey);
    updateLoadingState();
  }

  // --- SIGNING HELPER ---
  async function signRequest(action, timestamp, secret, params) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const payload = encoder.encode(
      action + "|" + timestamp + "|" + JSON.stringify(params),
    );

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      payload,
    );
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const internalCancel = { cancelled: false, run: null };

  // Placeholder - will be replaced with actual cancel function
  const cancelWrapper = () => {
    internalCancel.cancelled = true;
    if (internalCancel.run) internalCancel.run();
  };

  // Add to activeRequests BEFORE creating promise to prevent duplicates
  const requestEntry = { promise: null, cancel: cancelWrapper };
  activeRequests.set(requestKey, requestEntry);

  const promise = (async () => {
    try {
      // Check if cancelled before starting expensive signing
      if (internalCancel.cancelled) {
        throw new Error("Request cancelled");
      }

      const timestamp = Date.now().toString();
      const signature = await signRequest(
        action,
        timestamp,
        signingKey,
        sortedParams,
      );

      return new Promise((resolve, reject) => {
        // Check if cancelled during signing
        if (internalCancel.cancelled) {
          reject(new Error("Request cancelled"));
          return;
        }

        const url = new URL(SCRIPT_URL);
        url.searchParams.append("action", action);

        // sessionId is already in sortedParams, so it will be added in the loop below

        url.searchParams.append("timestamp", timestamp);
        url.searchParams.append("signature", signature);

        for (const key in sortedParams) {
          url.searchParams.append(key, sortedParams[key]);
        }

        const callbackName = `jsonp_callback_${Date.now()}_${callbackCounter++}`;
        url.searchParams.append("callback", callbackName);

        const script = document.createElement("script");
        const timeout = 15000; // 15 seconds
        let cleanedUp = false;
        let timeoutId;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;

          clearTimeout(timeoutId);
          if (window[callbackName]) {
            delete window[callbackName];
          }
          if (document.body.contains(script)) {
            document.body.removeChild(script);
          }
          activeRequests.delete(requestKey);

          if (!options.skipLoading) {
            loadingRequests.delete(requestKey);
            updateLoadingState();
          }

          internalCancel.run = null;
        };

        // Assign the real cleanup to our internal cancel handler
        internalCancel.run = cleanup;

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Request timed out."));
        }, timeout);

        window[callbackName] = (data) => {
          cleanup();
          if (data.success) {
            resolve(data);
          } else {
            if (data.message === "Unauthorized") {
              clearSession();
              document.dispatchEvent(new CustomEvent("sessionExpired"));
            }
            reject(new Error(data.message || "API request failed."));
          }
        };

        script.onerror = () => {
          cleanup();
          reject(new Error("Network error during API request."));
        };

        // Final check: if we were cancelled or timed out during the signing/setup phase
        if (cleanedUp) {
          reject(new Error("Request cancelled during setup"));
          return;
        }

        script.src = url.toString();
        document.body.appendChild(script);
      });
    } catch (err) {
      // Handle signing errors or other prep errors
      activeRequests.delete(requestKey);
      if (!options.skipLoading) {
        loadingRequests.delete(requestKey);
        updateLoadingState();
      }
      throw err;
    }
  })();

  requestEntry.promise = promise;
  return promise;
};

const ApiService = {
  login: (apiKey) => request("login", {}, { apiKey }),
  ping: () => request("ping", {}, { skipLoading: true }),
  logout: () => request("logout", {}, { skipLoading: true }),
  getAppData: () => request("getAppData"),
  getData: () => request("getData"),
  saveData: (data, options = {}) =>
    requestMutating("saveData", { data: JSON.stringify(data) }, options),
  addTag: (type, value) => requestMutating("addTag", { type, value }),
  updateExpenses: (data, options = {}) =>
    requestMutating("updateExpenses", { data: JSON.stringify(data) }, options),
  deleteTag: (type, value) => requestMutating("deleteTag", { type, value }),
  renameTag: (type, oldValue, newValue) =>
    requestMutating("renameTag", { type, oldValue, newValue }),
  processTagOperations: (operations, options = {}) =>
    requestMutating(
      "processTagOperations",
      { operations: JSON.stringify(operations) },
      options,
    ),
  getOpeningBalance: () => request("getOpeningBalance"),
  saveOpeningBalance: (balance, options = {}) =>
    requestMutating("saveOpeningBalance", { balance }, options),

  splitTransaction: async (original, splits, options = {}) => {
    const res = await requestMutating(
      "splitTransaction",
      { data: JSON.stringify({ original, splits }) },
      options,
    );
    store.setState("splitTransactions", null); // Invalidate cache
    return res;
  },
  revertSplit: async (groupId, options = {}) => {
    const res = await requestMutating("revertSplit", { groupId }, options);
    store.setState("splitTransactions", null); // Invalidate cache
    return res;
  },
  editSplit: async (groupId, splits, original, options = {}) => {
    const res = await requestMutating(
      "editSplit",
      { groupId, data: JSON.stringify({ original, splits }) },
      options,
    );
    store.setState("splitTransactions", null); // Invalidate cache
    return res;
  },
  getSplitGroup: (groupId) => request("getSplitGroup", { groupId }),
  getSplitTransactions: async (options = {}) => {
    const cached = store.getState("splitTransactions");
    if (cached && !options.forceRefresh) {
      return { success: true, data: cached };
    }

    let allData = [];
    let page = 1;
    let hasMore = true;

    // Use a unique key to represent this batch operation in the loading set
    const batchLoadingKey = `batch-split-history-${Date.now()}`;
    loadingRequests.add(batchLoadingKey);
    updateLoadingState();

    try {
      while (hasMore) {
        store.setState(
          "taggingProgress",
          `Loading split history (Page ${page})...`,
        );
        // Use skipLoading: true because we are managing loading state manually for the whole loop
        const res = await request(
          "getSplitHistory",
          { page, pageSize: 500 },
          { skipLoading: true },
        );

        if (!res.success) {
          throw new Error(res.message);
        }

        allData.push(...res.data);
        hasMore = res.hasMore;
        page++;
      }

      store.setState("splitTransactions", allData);
      return { success: true, data: allData };
    } finally {
      loadingRequests.delete(batchLoadingKey);
      updateLoadingState();
      store.setState("taggingProgress", null);
    }
  },

  getScriptUrl,
  setScriptUrl,
  hasScriptUrl,
  setSession,
  clearSession,
  hasSession,
};

export default ApiService;
