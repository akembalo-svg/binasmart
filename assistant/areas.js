'use strict';
// Addis Ababa areas as people type them (first name in each group = the canonical one). Moved out of server.js on
// 30 Sep 2026 so Dr Afiya reads a health-place question the same way Bini does (assistant/health-args.js).
const AREA_GROUPS = [['bole','ቦሌ'],['sarbet','sar bet','ሳርቤት','ሳር ቤት'],['cmc','ሲኤምሲ','ሲ ኤም ሲ'],['ayat','አያት'],['kazanchis','ካዛንቺስ'],
  ['megenagna','መገናኛ'],['piassa','piazza','ፒያሳ','ፒያሳ'],['gerji','ገርጂ'],['summit','semit','ሰሚት'],['lebu','ለቡ'],['jemo','ጀሞ'],
  ['old airport','ኦልድ ኤርፖርት','አሮጌው አየር ማረፊያ'],['mexico','ሜክሲኮ','ሜክሲኳ'],['lafto','ላፍቶ'],['kality','kaliti','ቃሊቲ'],['kolfe','ኮልፌ'],
  ['yeka','የካ'],['gulele','ጉለሌ'],['arada','አራዳ'],['lideta','ልደታ'],['kirkos','ቂርቆስ'],['akaki','አቃቂ'],['atlas','አትላስ'],
  ['bisrate gabriel','ብስራተ ገብርኤል'],['la gare','lagare','la gahre','ላጋር','ላ ጋር'],['tor hailoch','ጦር ኃይሎች'],['wello sefer','welo sefer','ወሎ ሰፈር'],
  ['goro','ጎሮ'],['hayat','ሃያት'],['shola','ሾላ'],['signal','ሲግናል'],['gotera','ጎተራ'],['saris','ሳሪስ'],['jackros','ጃክሮስ'],
  ['teklehaymanot','tekle haymanot','ተክለሃይማኖት','ተክለ ሃይማኖት'],['british embassy','እንግሊዝ ኤምባሲ'],['canada embassy','ካናዳ ኤምባሲ'],['bulbula','ቡልቡላ'],['edna mall','ኤድና ሞል']];
const squash = v => String(v || '').toLowerCase().replace(/\s+/g, '');
module.exports = { AREA_GROUPS, squash };
