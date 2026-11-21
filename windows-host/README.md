# winss132r Windows host

winss132r is for attended support on Windows 10/11 x64, with an optional
unattended mode for designated company PCs (see below). The installer runs
without administrator privileges and adds a Start menu shortcut and an
uninstall entry for the current user. It is unsigned; follow your organization's
software policy. There is no Windows service. Automatic startup is added only when unattended access is turned on.
If you installed the older Deskline preview, uninstall it separately from Windows Settings.

## Start a session

1. Open the winss132r viewer in a browser at the relay's HTTPS origin.
2. On the Windows PC, download and run the installer, then open **winss132r**
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

1. Open winss132r, paste the relay address, and select **Unattended…**.
   Confirm the prompt. This is the only prompt; there is none during a session.
2. winss132r saves a random key in `%LOCALAPPDATA%\winss132r\unattended.json`
   (not roaming) and adds itself to sign-in startup for this Windows user
   (`HKCU\...\CurrentVersion\Run`), so the same code works after restarts.
   The 12-character access code is derived from that key and shown in the
   status window. Only this PC's key can register that code on the relay.
3. IT enters the access code in the viewer. The session goes live at once,
   with no verification number and no approval.

There are no pop-ups while unattended access runs. The status window stays
minimized on the taskbar, and an icon is added to the notification area. Both
are blue when ready, amber when the relay can't be reached, and turn **red**
(with a taskbar badge and a "LIVE" title) while IT is connected. Click either
to see the connection status, the number of connections since the app started,
and the access code. From that window the user can **Stop current session**,
**Exit** (unattended access starts again at next sign-in), or **Turn off
unattended access**, which deletes the key and the startup entry. Ctrl+2 and
F12 still end a live session, and locking Windows still stops sharing.
Windows 11 may put new notification-area icons in the overflow; pin it under
Settings > Personalization > Taskbar > Other system tray icons. The taskbar
button is always visible.

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
node --test artifacts/api-server/tests/deskline.test.mjs
```

The build writes the installer to `artifacts/deskline/public/downloads/`.
Generate it before building the browser viewer for distribution if it is
missing from a fresh checkout. Keep the API and viewer on the same origin,
with `/api/deskline/` routed to the API service behind HTTPS. On Windows,
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
