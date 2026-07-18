(function(global){
  const IMG_DEFAULT = 'https://i.postimg.cc/Y0GT5M1f/image.png';

  const GINGER_LEMON_MIXINS = Object.freeze([
    {id:'add-mint', ar:'إضافة نعناع', en:'Add Mint', price:0},
    {id:'add-lemon', ar:'إضافة ليمون', en:'Add Lemon', price:0},
    {id:'add-ginger', ar:'إضافة زنجبيل', en:'Add Ginger', price:0},
    {id:'add-honey', ar:'إضافة عسل (+1)', en:'Add Honey (+1 SAR)', price:1},
    {id:'remove-lemon', ar:'إزالة ليمون', en:'No Lemon', price:0},
    {id:'remove-honey', ar:'إزالة عسل', en:'No Honey', price:0},
    {id:'remove-ginger', ar:'إزالة زنجبيل', en:'No Ginger', price:0},
    {id:'remove-mint', ar:'إزالة نعناع', en:'No Mint', price:0}
  ]);

  const MENU_DATA = {
    hot: {
      coffee: [
        {ar:'ڤي 60', en:'V60', price:13, cal:5, img:IMG_DEFAULT},
        {ar:'قهوة اليوم', en:'Coffee of the Day', price:8, cal:5, img:IMG_DEFAULT},
        {
          ar:'امريكانو',
          en:'Americano',
          price:6,
          cal:5,
          img:IMG_DEFAULT,
          defaultVariantKey:'small',
          variantHeadingKey:'size',
          variantNoteKey:'size',
          variants:[
            {key:'small', ar:'حجم صغير', en:'Small', price:6, cal:5},
            {key:'large', ar:'حجم كبير', en:'Large', price:8, cal:10}
          ]
        },
        {ar:'اسبريسو', en:'Espresso', price:6, cal:5, img:IMG_DEFAULT},
        {ar:'قهوة تركي', en:'Turkish Coffee', price:8, cal:15, img:IMG_DEFAULT},
        {ar:'جبنة (قهوة سودانية)', en:'Jabana (Sudanese Coffee)', price:6, cal:10, img:'https://i.postimg.cc/Wzg42WLQ/image.png'},
        {ar:'جبنة في جبنة (وسط)', en:'Jabana in Jabana (Medium)', price:16, cal:20, img:IMG_DEFAULT},
        {ar:'سبانش', en:'Spanish Latte (Hot)', price:12, cal:180, img:IMG_DEFAULT},
        {ar:'وايت موكا', en:'White Mocha (Hot)', price:18, cal:280, img:'https://i.postimg.cc/DZtZ3VDc/image.png'},
        {ar:'لاتيه', en:'Latte (Hot)', price:12, cal:190, img:'https://i.postimg.cc/tTgRxR08/image.png'},
        {ar:'كابتشينو', en:'Cappuccino', price:12, cal:120, img:IMG_DEFAULT},
        {ar:'كورتادو', en:'Cortado', price:7, cal:90, img:IMG_DEFAULT},
        {ar:'فلات وايت', en:'Flat White', price:12, cal:150, img:IMG_DEFAULT},
        {ar:'ميكاتو', en:'Macchiato', price:7, cal:25, img:IMG_DEFAULT},
        {ar:'قهوة فرنسي', en:'French Coffee', price:9, cal:120, img:IMG_DEFAULT}
      ],
      tea: [
        {ar:'شاي', en:'Tea', price:3, cal:2, img:IMG_DEFAULT},
        {ar:'شاي تلقيمة', en:'Loose Leaf Tea', price:7, cal:5, img:IMG_DEFAULT, mixins:GINGER_LEMON_MIXINS},
        {
          ar:'زنجبيل بالليمون',
          ar:'مشروب الزنجبيل بالليمون',
          en:'Ginger Lemon Drink',
          price:7,
          cal:20,
          img:IMG_DEFAULT,
          defaultVariantKey:'small',
          variantHeadingKey:'size',
          variantNoteKey:'size',
          variants:[
            {key:'small', ar:'حجم صغير', en:'Small', price:7, cal:20},
            {key:'large', ar:'حجم كبير', en:'Large', price:9, cal:28}
          ],
          mixins:GINGER_LEMON_MIXINS
        },
        {ar:'شاي مقنن', en:'Strong Tea', price:8, cal:2, img:IMG_DEFAULT},
        {ar:'شاي حليب', en:'Milk Tea', price:6, cal:140, img:IMG_DEFAULT},
        {ar:'هوت شوكلت', en:'Hot Chocolate', price:13, cal:300, img:IMG_DEFAULT},
        {ar:'ماتشا', en:'Matcha (Hot)', price:16, cal:180, img:'https://i.postimg.cc/SRCKyTF5/image.png'}
      ]
    },
    cold: {
      coffee: [
        {ar:'ڤي 60', en:'V60 (Iced)', price:13, cal:5, img:'https://i.postimg.cc/L8dVZxHs/12.png'},
        {ar:'قهوة اليوم', en:'Coffee of the Day (Iced)', price:8, cal:5, img:IMG_DEFAULT},
        {ar:'امريكانو', en:'Iced Americano', price:9, cal:5, img:IMG_DEFAULT},
        {ar:'سبانش', en:'Spanish Latte (Iced)', price:17, cal:180, img:IMG_DEFAULT},
        {ar:'لاتيه', en:'Iced Latte', price:12, cal:190, img:IMG_DEFAULT},
        {ar:'سبانش لاتيه', en:'Spanish Latte', price:14, cal:220, img:IMG_DEFAULT},
        {ar:'وايت موكا', en:'White Mocha (Iced)', price:18, cal:300, img:'https://i.postimg.cc/DZtZ3VDc/image.png'},
        {ar:'نيمة شيكن', en:'Neema Chicken (Cold Drink)', price:19, cal:220, img:'https://i.postimg.cc/QtBtzN69/image.png'},
        {ar:'بستاشيو لاتيه', en:'Pistachio Latte (Iced)', price:18, cal:280, img:IMG_DEFAULT}
      ],
      mojito: [
        {ar:'موهيتو', en:'Mojito', price:17, cal:120, img:IMG_DEFAULT},
        {
          ar:'موهيتو مكس',
          en:'Mojito Mix',
          price:15,
          cal:140,
          defaultVariantKey:'7up',
          img:'https://i.postimg.cc/3NmwKS5s/image.png',
          variants:[
            {key:'7up', ar:'سفن آب', en:'7up', price:15, cal:140, img:'https://i.postimg.cc/XJTJ6Mh5/image.png'},
            {key:'code-red', ar:'كود رد', en:'Code Red', price:17, cal:140, img:'https://i.postimg.cc/3NmwKS5s/image.png'}
          ]
        },
        {
          ar:'موهيتو بلو بيري',
          en:'Blueberry Mojito',
          price:15,
          cal:150,
          defaultVariantKey:'7up',
          img:'https://i.postimg.cc/BQwV7rxQ/8.png',
          variants:[
            {key:'7up', ar:'سفن آب', en:'7up', price:15, cal:150},
            {key:'code-red', ar:'كود رد', en:'Code Red', price:17, cal:170}
          ]
        },
        {
          ar:'موهيتو فراولة',
          en:'Strawberry Mojito',
          price:15,
          cal:150,
          defaultVariantKey:'7up',
          img:'https://i.postimg.cc/PxLx7f6K/image.png',
          variants:[
            {key:'7up', ar:'سفن آب', en:'7up', price:15, cal:150},
            {key:'code-red', ar:'كود رد', en:'Code Red', price:17, cal:170}
          ]
        },
        {
          ar:'موهيتو بطيخ',
          en:'Watermelon Mojito',
          price:15,
          cal:140,
          defaultVariantKey:'7up',
          img:IMG_DEFAULT,
          variants:[
            {key:'7up', ar:'سفن آب', en:'7up', price:15, cal:140},
            {key:'code-red', ar:'كود رد', en:'Code Red', price:17, cal:160}
          ]
        },
        {
          ar:'موهيتو باشن فروت',
          en:'Passion Fruit Mojito',
          price:15,
          cal:150,
          defaultVariantKey:'7up',
          img:'https://i.postimg.cc/cHVHGqjn/image.png',
          variants:[
            {key:'7up', ar:'سفن آب', en:'7up', price:15, cal:150},
            {key:'code-red', ar:'كود رد', en:'Code Red', price:17, cal:170}
          ]
        }
      ],
      other:[
        {ar:'كركديه', en:'Hibiscus', price:8, cal:50, img:'https://i.postimg.cc/Fz9MmhB2/11.png'},
        {ar:'سموذي كركدي', en:'Hibiscus Smoothie', price:15, cal:180, img:'https://i.postimg.cc/7YNLg64T/2.png'},
        {ar:'ماء', en:'Water', price:1, cal:0, img:'https://i.postimg.cc/ZqfZw7K8/f11d7585-3f1a-4bb1-95d4-c10e9393bad7-500x500-684-HWh-Kqw4-JSS2b-Dk6wp-FGnd5sxpq-Xz-Ch-ZAXt-Bnk.webp'}
      ]
    },
    dessert: {
      cake: [
        {ar:'نيمة كيك', en:'Neema Cake', price:18, cal:420, img:'https://i.postimg.cc/YCRwSnF5/image.jpg'},
        {ar:'مولتن دارك تشوكليت', en:'Molten Dark Chocolate', price:17, cal:450, img:'https://i.postimg.cc/QNqLmY4H/images.jpg'}
      ],
      side: [
        {ar:'ينسون', en:'Anise Tea', price:4, cal:5, img:'https://i.postimg.cc/9FfdSzpy/images.jpg'},
        {ar:'بسكويت شاي كبير', en:'Tea Biscuit (Large)', price:9, cal:200, img:'https://i.postimg.cc/L8t8331D/4-1.png'},
        {ar:'بسكويت شاي صغير', en:'Tea Biscuit (Small)', price:5, cal:100, img:'https://i.postimg.cc/L8t8331D/4-1.png'},
        {ar:'لقيمات', en:'Luqaimat', price:14, cal:320, img:'https://i.postimg.cc/ZnmSR1fh/image.webp'}
      ]
    }
  };

  function getLangToggleLabel(currentLang){
    return currentLang === 'ar' ? 'E' : 'ع';
  }

  const frozen = {
    IMG_DEFAULT,
    MENU_DATA: Object.freeze(MENU_DATA),
    getLangToggleLabel
  };

  global.NEEMA_SHARED = Object.assign({}, global.NEEMA_SHARED || {}, frozen);
})(typeof window !== 'undefined' ? window : globalThis);
