const Service_Auth = {
  getPasskeys: function () {
    try {
      const sheet = _getConfigSheet();
      const normalize = (value) => {
        if (!value || typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
      };
      return {
        admin: normalize(sheet.getRange(CONFIG.API_KEY_CELL).getValue()),
        viewer: normalize(
          sheet.getRange(CONFIG.VIEW_ONLY_API_KEY_CELL).getValue(),
        ),
      };
    } catch (e) {
      console.error("Error retrieving passkeys: " + e.message);
      return { admin: null, viewer: null };
    }
  },

  getApiKey: function () {
    const passkeys = this.getPasskeys();
    return passkeys.admin;
  },

  login: function (role) {
    const sessionRole = role === "viewer" ? "viewer" : "admin";
    const passkeys = this.getPasskeys();

    if (sessionRole === "admin" && !passkeys.admin) {
      console.error("Login failed: admin passkey not configured.");
      return { success: false, message: "Server misconfigured" };
    }
    if (sessionRole === "viewer" && !passkeys.viewer) {
      console.error("Login failed: viewer passkey not configured.");
      return { success: false, message: "Server misconfigured" };
    }

    const session = Service_Session.createSession(sessionRole);

    if (!session || !session.sessionId || !session.sessionKey) {
      console.error("Login failed: Unable to create session.");
      return { success: false, message: "Session creation failed" };
    }

    return {
      success: true,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      role: sessionRole,
    };
  },

  _canonicalize: function (value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => this._canonicalize(v));
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((k) => {
        out[k] = this._canonicalize(value[k]);
      });
    return out;
  },

  _buildPayload: function (action, timestamp, allParams) {
    const ignoredKeys = ["action", "timestamp", "signature", "callback"];
    const paramKeys = Object.keys(allParams || {}).filter(
      (k) => !ignoredKeys.includes(k),
    );
    paramKeys.sort();

    const sortedParams = {};
    paramKeys.forEach((k) => (sortedParams[k] = allParams[k]));

    return (
      action +
      "|" +
      timestamp +
      "|" +
      JSON.stringify(this._canonicalize(sortedParams))
    );
  },

  _computeSignatureHex: function (payload, secretKey) {
    const signatureBytes = Utilities.computeHmacSha256Signature(
      payload,
      secretKey,
    );
    return signatureBytes.reduce(function (str, byte) {
      const v = (byte < 0 ? byte + 256 : byte).toString(16);
      return str + (v.length === 1 ? "0" + v : v);
    }, "");
  },

  _isSignatureMatch: function (providedSignature, expectedSignature) {
    if (!providedSignature || !expectedSignature) return false;
    const expected = expectedSignature.toLowerCase();
    const provided = String(providedSignature).toLowerCase();

    if (expected.length !== provided.length) return false;

    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    return mismatch === 0;
  },

  verifyRequest: function (action, timestamp, signature, allParams) {
    try {
      const now = Date.now();
      const reqTime = parseInt(timestamp, 10);
      if (isNaN(reqTime)) {
        return { authorized: false };
      }
      if (Math.abs(now - reqTime) > 300000) {
        console.warn("Request rejected: Timestamp out of bounds");
        return { authorized: false };
      }

      const payload = this._buildPayload(action, timestamp, allParams);
      if (action === "login") {
        const cache = CacheService.getScriptCache();
        // TRADEOFF: This counter is GLOBAL — GAS does not expose the client IP,
        // so we cannot scope it per-caller. Consequence: 10 failed login attempts
        // from ANY source in a single 10-minute window will lock out ALL users
        // for the remainder of that window. This is a known denial-of-service
        // risk accepted because no per-IP isolation primitive exists in GAS.
        // The window resets automatically at the next 10-minute boundary.
        const bucketKey = "bf_" + Math.floor(Date.now() / 600000);
        const failCount = parseInt(cache.get(bucketKey) || "0", 10);
        if (failCount >= 10) {
          console.warn("Login rejected: too many failed attempts");
          return { authorized: false };
        }

        const passkeys = this.getPasskeys();
        if (passkeys.admin) {
          const adminSig = this._computeSignatureHex(payload, passkeys.admin);
          if (this._isSignatureMatch(signature, adminSig)) {
            cache.put(bucketKey, "0", 600);
            return { authorized: true, role: "admin" };
          }
        }
        if (passkeys.viewer) {
          const viewerSig = this._computeSignatureHex(payload, passkeys.viewer);
          if (this._isSignatureMatch(signature, viewerSig)) {
            cache.put(bucketKey, "0", 600);
            return { authorized: true, role: "viewer" };
          }
        }

        cache.put(bucketKey, String(failCount + 1), 600);
        return { authorized: false };
      }

      const sessionId = allParams ? allParams.sessionId : null;
      if (!sessionId) {
        console.warn("Request rejected: Missing sessionId");
        return { authorized: false };
      }

      const session = Service_Session.getSession(sessionId);
      if (!session || !session.sessionKey) {
        console.warn("Request rejected: Invalid or expired session");
        return { authorized: false };
      }

      const expectedSignature = this._computeSignatureHex(
        payload,
        session.sessionKey,
      );
      if (!this._isSignatureMatch(signature, expectedSignature)) {
        return { authorized: false };
      }

      return {
        authorized: true,
        role: session.role === "admin" ? "admin" : "viewer",
      };
    } catch (e) {
      console.error("Error in verifyRequest: " + e.message);
      return { authorized: false };
    }
  },
};
