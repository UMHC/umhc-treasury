// src/services/auth.service.js
import store from "../core/state.js";
import ApiService from "./api.service.js";

/**
 * AUTHENTICATION SERVICE
 * Implements session-based authentication with short-lived tokens.
 *
 * Security Model:
 * 1. User enters a passkey.
 * 2. Passkey is sent to server ONCE to exchange for a Session.
 * 3. Server returns { sessionId, sessionKey }.
 * 4. We store sessionId/sessionKey in private variables in ApiService AND sessionStorage for persistence.
 * 5. We discard the Passkey.
 * 6. All subsequent requests are signed with sessionKey and include sessionId.
 */
const AuthService = {
  buildCurrentUser(role) {
    const normalizedRole = role === "admin" ? "admin" : "viewer";
    return {
      loggedIn: true,
      role: normalizedRole,
      canEdit: normalizedRole === "admin",
    };
  },

  /**
   * Check if there is a session in local storage (via ApiService) and initialize the app state.
   */
  init: async function () {
    // ApiService initializes its session from sessionStorage automatically on import/load.
    // We just need to check if it has a valid session.
    if (ApiService.hasSession()) {
      store.setState("isVerifyingSession", true);
      try {
        // Validate session with server
        const response = await ApiService.ping();
        store.setState("currentUser", this.buildCurrentUser(response?.role));
      } catch (error) {
        console.warn("Session validation failed:", error);
        this.logout();
      } finally {
        store.setState("isVerifyingSession", false);
      }
    }
  },

  /**
   * Attempt to log in with the provided passkey.
   * @param {string} apiKey
   * @returns {Promise<boolean>} - True if login is successful, false otherwise.
   */
  login: async function (apiKey) {
    store.setState("error", null);

    try {
      // 1. Exchange passkey for session
      const response = await ApiService.login(apiKey);

      if (
        response.success &&
        response.sessionId &&
        response.sessionKey &&
        response.role
      ) {
        // 2. Set Session Credentials in ApiService (memory + sessionStorage)
        ApiService.setSession(response.sessionId, response.sessionKey);

        // 3. Update State (Auth status + role/capabilities, no credentials in store)
        store.setState("currentUser", this.buildCurrentUser(response.role));

        return true;
      } else {
        // Server responded but rejected the login (e.g. wrong passkey)
        store.setState(
          "error",
          response.message || "Login failed. Please check your passkey.",
        );
        return false;
      }
    } catch (error) {
      // Network/timeout failure — server was not reached
      console.error("Login failed:", error);
      store.setState(
        "error",
        "Could not reach server. Please check your connection and try again.",
      );
      return false;
    }
  },

  /**
   * Log the user out by clearing session credentials and user state.
   * Also invalidates the session server-side so stolen credentials cannot be reused.
   */
  logout: async function () {
    try {
      await ApiService.logout();
    } catch (_) {
      // Fire-and-forget — always clear local state even if the server call fails
    }
    ApiService.clearSession();
    store.setState("currentUser", null);
  },

  /**
   * Check if the user is currently logged in.
   * @returns {boolean}
   */
  isLoggedIn: function () {
    return (
      ApiService.hasSession() &&
      !!store.getState("currentUser") &&
      ApiService.hasScriptUrl()
    );
  },
};

export default AuthService;
