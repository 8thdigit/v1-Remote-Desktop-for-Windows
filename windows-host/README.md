# Msfwr Windows host

Msfwr is for attended support on Windows 10/11 x64, with an optional
unattended mode for designated company PCs (see below). The installer runs
without administrator privileges and adds a Start menu shortcut and an
uninstall entry for the current user. It is unsigned; follow your organization's
software policy. There is no Windows service. Automatic startup is added only when unattended access is turned on.
If you installed the older Msfwr preview, uninstall it separately from Windows Settings.

## Start a session

1. Open the Msfwr viewer in a browser at the relay's HTTPS origin.
2. On the Windows PC, download and run the installer, then open **Msfwr**
   from Start. Paste the HTTPS relay address displayed on the viewer page.
   Select **Save & Close** to remember just the address on your Windows account.
   Reopen the app to reuse it, or select **Clear saved relay** to remove it.
   A saved address does not authorize access or replace one-time pairing.
3. Select **Start session** and give the one-time code to a trusted helper. The helper enters it in their
   browser and reads the six-digit verification number back to you. Enter that
   number in the Windows host and select **Approve**, or select **Decline**
   to end the request. In this attended mode there is no automatic approval.
4. The helper can enable remote input from the viewer. The Windows user can
   stop the session with **Ctrl+2**, **F12**, or **Stop sharing** on the
   always-on-top indicator. The setup window minimizes to the taskbar on
   approval. Its taskbar icon shows a live badge when Windows supports
   overlays; click the taskbar button to restore the client and see session
   status and the **Stop sharing** button. Shift-right-click its taskbar button to open the Windows system
   menu with **Stop sharing** and **Close** (or open the window and press
   Alt+Space). Closing the app or the indicator ends the session. The helper
   can use **End session**. Locking Windows stops the host session.

## Unattended access (designated company PCs)

For PCs that IT supports without someone at the keyboard, the Windows user
can turn on a saved, pre-approved access code:

1. Open Msfwr, paste the relay address, and select **Unattended…**.
   Confirm the prompt. This is the only prompt; there is none during a session.
2. Msfwr saves a random key in `%LOCALAPPDATA%\Msfwr\unattended.json`
   (not roaming) and adds itself to sign-in startup for this Windows user
   (`HKCU\...\CurrentVersion\Run`), so the same code works after restarts.
   The 12-character access code is derived from that key and shown in the
   notification-area menu. Only this PC's key can register that code on the relay.
3. IT enters the access code in the viewer. The session goes live at once,
   with no verification number and no approval.

### Initiate from the PC

The PC can also ask IT to connect. In the viewer's **Unattended PCs** tab, IT
saves the PC's access code (it stays in that browser only); a PC is also saved
automatically the first time IT connects to it with its access code.
On the PC, click the Msfwr icon and select **Initiate — ask IT to connect**
(select it again to resend). The relay shows the request, with the PC's name,
to any viewer that saved that code, for two minutes. IT gets an Accept banner,
a chime and, if allowed, a desktop alert; **Accept** starts the session at once.
Viewers that have not saved the code see nothing.

The **Unattended PCs** tab also shows each saved PC as online, in a session or
offline, lets IT label and connect to it directly, and keeps a history of new
and previous requests (waiting, accepted, missed, dismissed) in that browser.

### The Msfwr window

Open **Msfwr** from Start (or left-click the notification-area icon, or pick
**Open Msfwr** in its menu) to see the Msfwr window while unattended access is
on. It shows:

- **Status**: ready, request sent, connected, offline or locked, with the
  latest detail, this PC's name and the relay address.
- **Access code** with **Copy access code**.
- **Controls**: **Initiate**, **Stop current session** and
  **Create remote access URL…**, plus **Turn off unattended…** and **Exit**.
- **Connections**: whether IT is connected now and for how long, the number
  of sessions since Msfwr started, a list of recent sessions (kept in memory
  only), and the active remote access URLs with **Copy URL** and **Revoke URL**.
- **Version**, for example `Msfwr v0.3.2 · Windows x64`.

Closing the window (or **Hide**) only hides it; unattended access keeps
running from the icon. When Msfwr starts at sign-in it stays in the
notification area and does not open the window. The relay does not report
who the viewer is, so the window shows when a session started, not a name.

### Notification-area icon

Apart from the Msfwr window above, which opens only when you ask for it, there
is no window and no pop-up during a session; only an icon in the notification area. It shows a
sync-arrows icon that is blue when ready, amber when the relay can't be
reached, and green while IT is connected. Its tooltip reads
**Connect: +01** while a session is live, counting sessions since the app
started (+02 for the second, and so on). Left-click the icon to open the Msfwr
window; right-click it for a small menu with the status, the access code, the connection count,
**Copy access code**, **Initiate**, **Stop current session**, **Turn off unattended access…**
(deletes the key and the startup entry), and **Exit** (unattended access
starts again at next sign-in). Ctrl+2 and F12 still end a live session, and
locking Windows still stops sharing. Windows 11 may put new notification-area
icons in the overflow; pin it under Settings > Personalization > Taskbar >
Other system tray icons. Short notification balloons say when a request was
sent and when IT connects or disconnects. Starting Msfwr again while it
runs brings its existing Msfwr window to the front instead of starting a second copy.

Anyone with the access code can control the PC while it is signed in, so
treat the code like a password. To change it, turn unattended access off and
on again. Uninstalling removes the key and the startup entry.

Shares the primary display only. No file transfer, clipboard sync, audio,
administrator elevation, or Windows sign-in/UAC control.
The relay terminates TLS and can read screen frames and control events. Use a
relay you and your helper trust. It holds only the latest frame in memory and
does not record sessions. Sessions are process-local and require a single
relay instance. Restarting that instance ends all sessions.

## Build and verify

At the repo root, with Go 1.26 and NSIS available, run:

```sh
bash windows-host/build.sh
(cd windows-host && go test ./...)
node --test artifacts/api-server/tests/msfwr.test.mjs
```

The build writes the installer to
`artifacts/msfwr/public/downloads/msfwr-Setup-x64.exe`.

## Publishing a release

The viewer's download button links to the installer on the latest GitHub
release:
`https://github.com/mailbhrp-1/Remote-Desktop-for-Windows/releases/latest/download/msfwr-Setup-x64.exe`.
To publish a new one, run the **Release installer** workflow from the Actions
tab with a new tag (for example `v0.2.0`), or push that tag. The workflow runs
the Go tests, builds the installer with the same `build.sh`, and attaches it to
the release. Keep the asset name `msfwr-Setup-x64.exe` so the link stays valid. Keep the API and viewer on the same origin,
with `/api/msfwr/` routed to the API service behind HTTPS. On Windows,
verify install/uninstall, pairing on two devices, streaming, remote input,
display scaling, Ctrl+2, F12, and locking Windows before distributing this preview.

## Trusted publisher signing

Smart App Control checks publisher trust, not the installer filename. Leave
it enabled. A self-signed certificate or an open-source signing tool by itself
does not provide a publisher that Windows trusts.

- [SignPath Foundation](https://signpath.org/) offers free signing for approved
  open-source projects. It verifies the artifact against the public repository;
  use its required build and submission process if accepted. Keep private
  repositories private unless you have explicitly decided to publish them.
- [Microsoft Artifact Signing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
  offers a paid Basic plan. Use a public-trust signing profile and complete
  publisher identity validation before attempting to sign a release.

For a provider that accepts individual binaries, run the build in an approved
build environment with `bash windows-host/build.sh --sign-with /absolute/path/to/signer`.
The signed build requires an NSIS version that supports `!uninstfinalize`:
check with `makensis -CMDHELP '!uninstfinalize'`, or set `MAKENSIS` to the path
of a newer compiler. The older preview compiler can still build unsigned
installers but is deliberately refused for signing.
The executable signer must accept one local file path, sign and timestamp it
in place through the authorized provider, verify the result, and return
nonzero on failure. It is called for the host, embedded uninstaller, and
installer. This hook does not enroll a publisher or provide credentials.
Keep private keys and provider credentials outside the repository.

The release is staged under `windows-host/dist/release.*`, not served by the
preview. Before distribution, use Windows SDK SignTool (`signtool verify /pa /all /v`)
on the installer, the installed host, and the installed uninstaller, check that
the expected publisher appears, then test installation and launch with Smart
App Control enabled. A signature check is not a substitute for that runtime test.
