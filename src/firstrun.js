const { db } = require('./db');

// First start only: adds the homepage banners (brand text, no pictures) so the site looks finished.
// No products, no sample stock, no sample SHEIN items. Edit or delete banners in Admin > Settings.
function seedBanners() {
  if (db.prepare('SELECT COUNT(*) c FROM banners').get().c) return;
  const B = db.prepare('INSERT INTO banners(title,subtitle,image,link,placement,sort,title_om,title_am,subtitle_om,subtitle_am) VALUES(?,?,?,?,?,?,?,?,?,?)');
  B.run('Born in Bale. Worn Everywhere.', 'Streetwear, sneakers and essentials. Message us to order.', '', '#/shop', 'hero', 0, 'Bale keessatti dhalate. Addunyaa guutuu keessatti uffatama.', 'በባሌ የተወለደ። በየትኛውም ቦታ የሚለበስ።', 'Uffata, kophee fi meeshaalee barbaachisoo. Ajajuuf nu quunnamaa.', 'የጎዳና ልብስ፣ ስኒከርና አስፈላጊ ዕቃዎች። ለማዘዝ ያግኙን።');
  B.run('New arrivals', 'Fresh pieces just landed.', '', '#/c/new-arrivals', 'hero', 1, 'Kan haaraa dhufan', 'አዲስ የደረሱ', 'Meeshaaleen haaraan amma dhufan.', 'አዳዲስ ዕቃዎች አሁን ደርሰዋል።');
  B.run('Special offers', 'Limited-time prices on selected pieces.', '', '#/c/special-offers', 'promo', 0, 'Kennaa addaa', 'ልዩ ቅናሾች', 'Gatii yeroo murtaa’eef meeshaalee filataman irratti.', 'በተመረጡ ዕቃዎች ላይ ለተወሰነ ጊዜ የሚቆይ ዋጋ።');
  B.run('SHEIN Orders', 'Found something on SHEIN? We can bring it to Ethiopia.', '', '#/shein', 'promo', 1, 'Ajaja SHEIN', 'የSHEIN ትዕዛዞች', 'SHEIN irratti wanta argatteettaa? Itiyoophiyaatti isiniif fideena.', 'በSHEIN ላይ የወደዱት አለ? ወደ ኢትዮጵያ እናመጣለን።');
}
module.exports = { seedBanners };
