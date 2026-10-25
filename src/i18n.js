// Server-side translations: category names, default shop texts, Telegram bot messages.
// Languages: en = English, om = Afaan Oromoo, am = Amharic.
const LANGS = ['en', 'om', 'am'];
const pickLang = v => (LANGS.includes(String(v)) ? String(v) : 'en');

const CATEGORY_NAMES = {
  tshirts: { om: 'Tishartii', am: 'ቲሸርቶች' },
  hoodies: { om: 'Huudii fi Sweetarii', am: 'ሁዲዎችና ሹራቦች' },
  shoes: { om: 'Kophee fi Sniikarii', am: 'ስኒከርና ጫማዎች' },
  trousers: { om: 'Surree fi Pantaaloonii', am: 'ሱሪዎች' },
  bags: { om: 'Boorsaa fi Meeshaalee dabalataa', am: 'ቦርሳዎችና መለዋወጫዎች' },
  electronics: { om: 'Meeshaalee Elektirooniksii', am: 'ኤሌክትሮኒክስ' },
  other: { om: 'Kan biroo', am: 'ሌሎች' },
};
const catName = (slug, fallback, lang) => (lang !== 'en' && CATEGORY_NAMES[slug] && CATEGORY_NAMES[slug][lang]) || fallback;

// Defaults for the translated shop texts (the owner can edit them in Admin > Settings).
const SETTING_TRANSLATIONS = {
  tagline_om: 'Bale keessatti dhalate. Addunyaa guutuu keessatti uffatama.',
  tagline_am: 'በባሌ የተወለደ። በየትኛውም ቦታ የሚለበስ።',
  delivery_info_om: 'Itiyoophiyaa guutuu keessatti geessina. Gatiin fi yeroon geessisaa magaalaa keessan irratti kan hundaa’u yoo nu quunnamtan nuti mirkaneessina.',
  delivery_info_am: 'በመላው ኢትዮጵያ እናደርሳለን። የማድረሻ ክፍያና ጊዜ እንደ ከተማዎ ይለያያል፤ ሲያገኙን እናረጋግጣለን።',
  policies_om: 'Gatiin Birriidhaan (ETB) kan eeramedha. Argamuun meeshaa nu quunnamtanii booda mirkana’a. Kaffaltii fi geessisni BALEOVA waliin kallattiin qindaa’a. Utuu hin bitin dura hamma fi halluu nu waliin mirkaneeffadhaa.',
  policies_am: 'ዋጋዎች በኢትዮጵያ ብር (ETB) ናቸው። ዕቃው መኖሩ ሲያገኙን ይረጋገጣል። ክፍያና ማድረስ በቀጥታ ከBALEOVA ጋር ይስማማል። ከመግዛትዎ በፊት መጠንና ቀለም ያረጋግጡ።',
  shein_notice_om: 'Gatiin SHEIN, kaffaltiin geessisaa, argamuu fi yeroon geessisaa ajaja keessan nuti osoo hin fudhatin dura nu waliin mirkanaa’uu qaba. Gatiin agarsiifame tilmaama qofa.',
  shein_notice_am: 'የSHEIN ዋጋ፣ የማጓጓዣ ክፍያ፣ ዕቃው መኖሩና የማድረሻ ጊዜ ትዕዛዝዎን ከመቀበላችን በፊት መረጋገጥ አለባቸው። የሚታየው ዋጋ ግምት ብቻ ነው።',
};
const LOCALIZED_SETTINGS = ['tagline', 'delivery_info', 'policies', 'shein_notice'];
function localizeSettings(s, lang) {
  const out = { ...s };
  for (const k of LOCALIZED_SETTINGS) { if (lang !== 'en' && s[`${k}_${lang}`]) out[k] = s[`${k}_${lang}`]; }
  for (const k of Object.keys(out)) if (/_(om|am)$/.test(k)) delete out[k];
  return out;
}

// Telegram bot messages
const BOT = {
  en: { welcome: n => `Welcome to ${n}. Tap the button below to browse. When you find something you like, contact us to order.`, open: 'Open BALEOVA Store', help: 'How it works:\n1. Browse the store.\n2. Tap Call, WhatsApp or Telegram on a product.\n3. We confirm stock, price and delivery with you and arrange the purchase directly.\n\nThere is no online payment. Use /stock to check availability.',
    stockHint: 'Send /stock followed by a product name or code, for example /stock hoodie', none: q => `No product found for "${q}". Open the store to browse everything.`, inStock: 'In stock', low: 'low stock', out: 'Out of stock', sizes: 'sizes', colours: 'colours',
    phone: 'Phone', wa: 'WhatsApp', loc: 'Location', hours: 'Hours', pickLang: 'Choose your language:', langSet: 'Language set to English.' },
  om: { welcome: n => `Baga nagaan dhuftan ${n}. Meeshaalee ilaaluuf button armaan gadii tuqaa. Kan jaallattan yoo argattan, ajajuuf nu quunnamaa.`, open: 'Suuqa BALEOVA Banaa', help: 'Haala itti hojjetu:\n1. Suuqa ilaalaa.\n2. Meeshaa irratti Bilbilaa, WhatsApp yookaan Telegram tuqaa.\n3. Argamuu, gatii fi geessisa isin waliin mirkaneessinee kallattiin bitannaa.\n\nKaffaltiin toora interneetii hin jiru. Argamuu ilaaluuf /stock fayyadamaa.',
    stockHint: 'Maqaa yookaan koodii meeshaa waliin /stock barreessaa, fknf /stock hoodie', none: q => `"${q}" jedhu hin argamne. Suuqa banaatii hunda ilaalaa.`, inStock: 'Jira', low: 'xiqqoo hafe', out: 'Dhume', sizes: 'hammoota', colours: 'halluuwwan',
    phone: 'Bilbila', wa: 'WhatsApp', loc: 'Bakka', hours: 'Sa’aatii hojii', pickLang: 'Afaan keessan filadhaa:', langSet: 'Afaan Afaan Oromootti jijjiirameera.' },
  am: { welcome: n => `እንኳን ወደ ${n} በደህና መጡ። ለማየት ከታች ያለውን ቁልፍ ይጫኑ። የወደዱትን ሲያገኙ ለማዘዝ ያግኙን።`, open: 'BALEOVA ሱቅን ክፈት', help: 'እንዴት እንደሚሰራ:\n1. ሱቁን ይመልከቱ።\n2. በምርቱ ላይ ደውል፣ ዋትስአፕ ወይም ቴሌግራም ይጫኑ።\n3. መኖሩን፣ ዋጋውንና ማድረሱን አረጋግጠን በቀጥታ እንስማማለን።\n\nየኦንላይን ክፍያ የለም። መኖሩን ለማየት /stock ይጠቀሙ።',
    stockHint: 'ከ /stock በኋላ የምርት ስም ወይም ኮድ ይጻፉ፣ ለምሳሌ /stock hoodie', none: q => `"${q}" የሚል ምርት አልተገኘም። ሁሉንም ለማየት ሱቁን ይክፈቱ።`, inStock: 'ይገኛል', low: 'ጥቂት ቀርቷል', out: 'አልቋል', sizes: 'መጠኖች', colours: 'ቀለሞች',
    phone: 'ስልክ', wa: 'ዋትስአፕ', loc: 'አድራሻ', hours: 'የሥራ ሰዓት', pickLang: 'ቋንቋዎን ይምረጡ:', langSet: 'ቋንቋ ወደ አማርኛ ተቀይሯል።' },
};
module.exports = { LANGS, pickLang, catName, CATEGORY_NAMES, SETTING_TRANSLATIONS, localizeSettings, BOT };
