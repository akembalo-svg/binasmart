// BinaSmart mini app for the telebirr SuperApp (Macle). One page: a full-screen web-view on bina.et.
// The site itself detects the SuperApp (?src=telebirr + the ma bridge) and uses in-app telebirr payment.
App({
  globalData: { base: 'https://bina.et', src: 'telebirr' },
  onLaunch(options) {
    // A deep link from the SuperApp (query.path=/ride, /cinema, /pool …) opens that page directly.
    if (options && options.query && options.query.path) this.globalData.path = String(options.query.path);
  },
  onShow() {}
});
