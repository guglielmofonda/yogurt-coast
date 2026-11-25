# Google Calendar sign-in

## Connect a calendar

Open **Agenda → Calendars → Sign in with Google**. Google opens in your default browser. After signing in, return to Yogurt and check the calendars you want to use. Shared calendars with event-read access appear alongside your own. The choice applies to the agenda, reminders, event linking and agents querying the calendar. **Refresh calendars** updates the list. New calendars start unchecked.

Each installation can connect one Google account. **Disconnect** removes the app’s saved Google authorization and calendar selection on that computer. You can also revoke access from your [Google Account](https://myaccount.google.com/permissions). Previously saved meeting notes remain available.

## Configure a build for distribution

The publisher does this once per app build. People who install a configured build sign in with their own Google accounts.

1. In the Google Cloud project for your app, enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), configure the application name, support contact and audience. Choose **External** for users outside your organization. While testing, add the Google accounts you intend to use as test users.
3. Add the read-only scopes `https://www.googleapis.com/auth/calendar.calendarlist.readonly` and `https://www.googleapis.com/auth/calendar.events.readonly`. Google grants calendar-reading capability at the account level. Yogurt enforces the calendar choices on the device before requesting any events. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
4. Create a **Desktop app** in [Clients](https://console.cloud.google.com/auth/clients), download its JSON, and copy it to `app/resources/google-calendar-client.json` before building. That file is excluded from Git and included in the packaged application. A local build can also use **Set up Google sign-in** to import its client file. Desktop client identifiers are distributed with the app. Each user’s refresh token is separate and stays encrypted on their computer. [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
5. Before a public launch, configure the production consent screen, privacy policy and verified domains in Google Auth Platform, and complete the verification Google requires for reading calendar events. [Google’s sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

The app uses the system browser, a one-time loopback callback and PKCE. It talks directly to Google. Access tokens stay in memory. Refresh tokens require OS-protected storage. Each connection starts with an empty calendar selection. Connecting Google disables the default Mac calendar feed unless the user has already set that preference. Calendar links added separately retain their settings.
