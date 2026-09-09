# BinaSmart mini app for the telebirr SuperApp (Macle)

One page, one full-screen `web-view` on https://bina.et (`?src=telebirr`). The site stays the single product; the mini app
is only the door into the SuperApp. Deep links: `pages/index/index?path=/ride` opens that page.

## Build (Windows PC with the Macle toolkit installed)
The compiler ships inside the Macle VS Code extension (macleteam.macle-miniprogram-tools-25.9.0):

    node miniapp/telebirr/build.js            # → miniapp/telebirr/dist/app.zip

Set `appid` in project.config.json to the App ID from the Mini Program Cloud console before a production build.

## Publish
Mini Program Cloud console (Manage My Mini APP on developer.ethiotelecom.et): upload app.zip → Set as Trial Version →
scan the trial QR with the sandbox SuperApp → Submit for Approve. Production: same in the production console; Ethio Telecom
reviews and releases. Remove any vconsole.js before production (there is none in this package).
