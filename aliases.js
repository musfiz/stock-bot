// পণ্যের নামের উপনাম তালিকা: Banglish ও বাংলা লেখা ধরতে embedding-এর আগেই মিলানো হয়।
export const ALIASES = {
  'Cup Dodhi': ['cup dodhi', 'dodhi', 'দই', 'কাপ দই', 'doi'],
  Laban: ['laban', 'লাবান', 'labaan'],
  Matha: ['matha', 'মাঠা', 'ghol', 'ঘোল'],
  'Pasteurized Milk': ['pasteurized milk', 'milk', 'dudh', 'দুধ', 'পাস্তুরিত দুধ'],
  'Slice Cheese': ['slice cheese', 'cheese', 'পনির', 'চিজ', 'slice ponir'],
  'Powder Milk': ['powder milk', 'gura dudh', 'গুঁড়া দুধ', 'powder dudh'],
  'Sour Yogurt': ['sour yogurt', 'tok doi', 'টক দই', 'sour doi'],
  'Chicken Noodles': ['chicken noodles', 'noodles', 'নুডলস', 'চিকেন নুডলস', 'nuduls'],
  'Chicken Ramen': ['chicken ramen', 'ramen', 'রামেন', 'চিকেন রামেন'],
  'Beef Ramen': ['beef ramen', 'gorur ramen', 'গরুর রামেন', 'beef raman'],
  'Aerosol Spray': ['aerosol', 'aerosol spray', 'স্প্রে', 'spray'],
  Atta: ['atta', 'ata', 'aata', 'আটা', 'flour atta'],
  'Electrolyte Drinks': ['electrolyte', 'saline drink', 'স্যালাইন', 'ইলেক্ট্রোলাইট'],
  'Plain Cake': ['plain cake', 'cake', 'কেক', 'প্লেইন কেক'],
  Rice: ['rice', 'chal', 'চাল', 'chaal'],
  'Mustard Oil': ['mustard oil', 'sorisar tel', 'সরিষার তেল', 'mustard tel'],
  Oil: ['oil', 'tel', 'তেল', 'soyabin', 'সয়াবিন'],
  'Puffed Rice': ['puffed rice', 'muri', 'মুড়ি', 'moori'],
  Chira: ['chira', 'চিড়া', 'চিরা', 'flattened rice'],
  Flour: ['flour', 'moyda', 'ময়দা', 'ata flour'],
  Salt: ['salt', 'lobon', 'লবণ', 'লবন'],
  Suji: ['suji', 'sujhi', 'সুজি', 'semolina'],
  'Mango Juice': ['mango juice', 'aamer juice', 'আমের জুস', 'mengo juice'],
  'Drinking Water': ['drinking water', 'water', 'pani', 'পানি', 'mineral water'],
};

// text normalize করে উপনাম খোঁজা, পেলে আসল product নাম ফেরত দেওয়া।
export function aliasMatch(text) {
  const t = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  for (const [name, words] of Object.entries(ALIASES)) {
    for (const w of words) {
      if (t.includes(w)) return name;
    }
  }
  return null;
}

// sync-এ embed text বানাতে কোনো পণ্যের উপনামগুলো নেওয়া।
export function aliasesFor(name) {
  return ALIASES[name] ?? [];
}
