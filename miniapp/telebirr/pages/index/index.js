// index.js — the whole BinaSmart web app inside one web-view.
var app = getApp();
Page({
  data: { url: '' },
  onLoad(options) {
    var path = (options && options.path) || app.globalData.path || '/';
    if (!/^\/[A-Za-z0-9\-_\/?=&.]*$/.test(path)) path = '/';
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    this.setData({ url: app.globalData.base + path + sep + 'src=' + app.globalData.src });
  },
  onMessage(e) {
    // bina.et may postMessage({ type: 'title', text }) to rename the bar, or { type: 'pay', rawRequest } is handled in-page via ma.native
    var d = e && e.detail && e.detail.data;
    if (d && d.length) { var last = d[d.length - 1]; if (last && last.type === 'title' && last.text && typeof ma !== 'undefined' && ma.setNavigationBarTitle) ma.setNavigationBarTitle({ title: String(last.text).slice(0, 40) }); }
  },
  onShareAppMessage() { return { title: 'BinaSmart — One App. Everything in Ethiopia.', path: 'pages/index/index' }; }
});
