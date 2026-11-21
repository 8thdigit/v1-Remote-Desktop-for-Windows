# winss132r Windows host

winss132r is for attended support on Windows 10/11 x64. The installer runs
without administrator privileges and adds a Start menu shortcut and an
uninstall entry for the current user. It is unsigned; follow your organization's
software policy. There is no Windows service or automatic startup.
If you installed the older Deskline preview, uninstall it separately from Windows Settings.

## Start a session

1. Open the winss132r viewer in a browser at the relay's HTTPS origin.
2. On the Windows PC, download and run the installer, then open **winss132r**
   from Start. Paste the HTTPS relay address displayed on the viewer page.
3. Give the one-time code to a trusted helper. The helper enters it in their
   browser and reads the six-digit verification number back to you. Enter that
   number in the Windows host to approve sharing the screen and allowing input.
4. The helper can enable remote input from the viewer. The Windows user can
   stop the session with **F12** or **OK** on the live-sharing notice. The helper
   can use **End session**. Locking Windows stops the host session.

Shares the primary display only. No file transfer, clipboard sync, audio,
unattended access, administrator elevation, or Windows sign-in/UAC control.
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
display scaling, F12, and locking Windows before distributing this preview.
