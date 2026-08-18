'use strict';

/**
 * Google Calendar (read-only) — polls upcoming events for the Wall
 * Dashboard's agenda. OAuth Authorization Code flow (the first real
 * browser-redirect OAuth in this codebase — see api-routes.js for the
 * /google-calendar/oauth/start and /callback routes); token refresh mirrors
 * smartthings-client.js's getToken()/_refreshToken() shape (10-min expiry
 * margin, dedup concurrent refreshes via a stored promise).
 *
 * As the calendar owner, an authenticated read already returns full detail
 * for the account's own private events — no separate "private events" mode
 * needed on Google's side.
 *
 * Config: config.googleCalendar = { clientId, clientSecret, calendarId }
 * Token persistence: persist/google-calendar-oauth.json
 */

const fs = require('fs');
const path = require('path');

const OAUTH_FILE = path.join(__dirname, '..', 'persist', 'google-calendar-oauth.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const POLL_MS = 5 * 60 * 1000;

class GoogleCalendarClient {
  constructor(config) {
    this.config = config.googleCalendar || {};
    this._oauth = this._loadOAuth();
    this._refreshing = null;
    this._events = [];
    this._pollTimer = null;
  }

  _loadOAuth() {
    try { return JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8')); }
    catch { return null; }
  }

  _saveOAuth(data) {
    fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
    fs.writeFileSync(OAUTH_FILE, JSON.stringify(data, null, 2));
    this._oauth = data;
  }

  isConnected() {
    return !!this._oauth?.refresh_token;
  }

  // redirectUri is derived per-request from the incoming host (see
  // api-routes.js) rather than hardcoded, since LSH may be reached at
  // different hostnames (local dev vs. a production deploy) — whichever is
  // used here must also be registered in the Google Cloud OAuth app.
  getAuthUrl(redirectUri) {
    const { clientId } = this.config;
    if (!clientId) throw new Error('googleCalendar.clientId not configured');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = this.config;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    this._saveOAuth({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
  }

  async _refreshToken() {
    if (this._refreshing) return this._refreshing;
    const { clientId, clientSecret } = this.config;
    this._refreshing = (async () => {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: this._oauth.refresh_token,
          client_id: clientId, client_secret: clientSecret,
          grant_type: 'refresh_token',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
      this._saveOAuth({ ...this._oauth, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 });
      return this._oauth.access_token;
    })();
    try { return await this._refreshing; }
    finally { this._refreshing = null; }
  }

  async getToken() {
    if (!this._oauth?.refresh_token) {
      throw new Error('Not connected — visit Settings → Calendar to connect Google Calendar');
    }
    if (!this._oauth.expires_at || Date.now() > this._oauth.expires_at - TOKEN_REFRESH_MARGIN_MS) {
      return this._refreshToken();
    }
    return this._oauth.access_token;
  }

  _normalize(ev) {
    const start = ev.start?.dateTime || ev.start?.date;
    if (!start) return null;
    const isAllDay = !ev.start.dateTime;
    return { date: start.slice(0, 10), title: ev.summary || '(No title)', time: isAllDay ? null : start.slice(11, 16) };
  }

  async _poll() {
    try {
      const token = await this.getToken();
      const calendarId = encodeURIComponent(this.config.calendarId || 'primary');
      const timeMin = encodeURIComponent(new Date().toISOString());
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`
        + `?timeMin=${timeMin}&singleEvents=true&orderBy=startTime&maxResults=20`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
      this._events = (data.items || []).map((ev) => this._normalize(ev)).filter(Boolean);
    } catch (err) {
      console.error(`[GoogleCalendar] Poll failed: ${err.message}`);
    }
  }

  getEvents() {
    return this._events;
  }

  async start() {
    if (this.isConnected()) await this._poll();
    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  stop() {
    if (this._pollTimer) clearInterval(this._pollTimer);
  }
}

module.exports = GoogleCalendarClient;
