// ==========================================
// 1. ตั้งค่าร้านค้าและการเชื่อมต่อ (CONFIG)
// ==========================================
const LINE_OA_ID = "@fernbitmju"; 

// ⚠️ ตั้งค่า Supabase ของคุณที่นี่
const SUPABASE_URL = 'https://xpetiobkllituiewqkos.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vZKcLK-PW_SVleLuJMmnjw_3ApwNLOf'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. ตัวแปรเก็บข้อมูลชั่วคราว (STATE)
// ==========================================
let products = [];
let categories = [];
let cart = [];
let promotions = []; // 🌟 เก็บข้อมูลรูปโปรโมชั่น
let activeCategory = 'All';
let searchQuery = '';
let selectedUnits = {}; 

let currentPromoSlide = 0;
let promoSlideInterval;

// ==========================================
// 🌟 3. ฟังก์ชันควบคุมเมนูแฮมเบอร์เกอร์
// ==========================================
window.toggleCategories = function() {
    // 🌟 ล็อกเมนูให้เปิดค้างไว้เสมอสำหรับหน้าจอคอมพิวเตอร์ (กว้าง 1024px ขึ้นไป)
    if (window.innerWidth >= 1024) return;

    const menu = document.getElementById('sidebar-categories');
    const chevron = document.getElementById('category-chevron');
    if (menu && chevron) {
        menu.classList.toggle('hidden');
        if (menu.classList.contains('hidden')) {
            chevron.style.transform = 'rotate(0deg)';
        } else {
            chevron.style.transform = 'rotate(180deg)';
        }
    }
}

// ==========================================
// 4. ฟังก์ชันดึงข้อมูลจาก Cloud
// ==========================================
async function fetchProductsFromCloud() {
    try {
        if (SUPABASE_KEY.includes('ใส่คีย์_ANON')) {
            console.log("⚠️ รบกวนแก้ไข API Key ก่อนครับ");
            document.getElementById('loading-spinner').style.display = 'none';
            return;
        }
        
        // ดึงข้อมูลสินค้า
        const { data: productData, error: productError } = await supabaseClient
            .from('products')
            .select(`
                *,
                product_groups (name),
                product_units (*)
            `);

        if (productError) throw productError;

        if (productData && productData.length > 0) {
            const activeData = productData.filter(p => p.status !== 1 && p.show_on_web === true);

            products = activeData.map(p => {
                let units = [];
                const sUnitName = p.s_unit ? p.s_unit.trim() : 'ชิ้น';
                if (p.web_show_s_unit && p.price1 > 0) {
                    units.push({ name: sUnitName, price: p.price1 });
                }

                if (p.web_show_l_unit && p.product_units && p.product_units.length > 0) {
                    p.product_units.forEach(u => {
                        const mUnitName = u.m_unit ? u.m_unit.trim() : null;
                        if (mUnitName && u.price2 > 0 && !units.find(x => x.name === mUnitName)) {
                            units.push({ name: mUnitName, price: u.price2 });
                        }
                        const lUnitName = u.l_unit ? u.l_unit.trim() : null;
                        if (lUnitName && u.price1 > 0 && !units.find(x => x.name === lUnitName)) {
                            units.push({ name: lUnitName, price: u.price1 });
                        }
                    });
                }

                return {
                    id: p.pn,
                    barcode: p.barcode,
                    name: p.name,
                    price: p.price1,
                    stock: p.stock,
                    image_url: p.image_url,
                    web_detail: p.web_detail, 
                    category: p.product_groups ? p.product_groups.name : 'ไม่มีหมวดหมู่',
                    is_hot: p.is_hot, 
                    units: units
                };
            }).filter(p => p.units.length > 0);
        }

        // 🌟 ดึงข้อมูลภาพโปรโมชั่นจาก Supabase
        const { data: promoData, error: promoError } = await supabaseClient
            .from('promotions')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
            
        if (!promoError && promoData) {
            promotions = promoData;
        }

        init(); 
    } catch (err) {
        console.error("JS Error:", err);
        document.getElementById('loading-spinner').style.display = 'none';
    }
}

// ==========================================
// 5. ฟังก์ชันแสดงผลหน้าเว็บ (UI Render)
// ==========================================
function init() {
    categories = [...new Set(products.map(p => p.category).filter(Boolean))];
    document.getElementById('loading-spinner').style.display = 'none';
    document.getElementById('category-products-grid').classList.remove('hidden');
    
    // 🌟 เช็คหน้าจอตอนเริ่มต้น (คอมพิวเตอร์=เปิดเมนูค้างไว้, iPad/มือถือ=ซ่อนเมนู)
    const menu = document.getElementById('sidebar-categories');
    const chevron = document.getElementById('category-chevron');
    if (menu && chevron) {
        if (window.innerWidth >= 1024) { // เปลี่ยนจาก 768 เป็น 1024 ให้คลุมถึง iPad
            menu.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
        } else {
            menu.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    renderPromotions(); // 🌟 สั่งให้วาดภาพโปรโมชั่นสไลด์
    renderSidebar(); renderTabs(); renderProducts();
}

// 🌟 ระบบวาดสไลด์โปรโมชั่น
function renderPromotions() {
    const slider = document.getElementById('promo-slider');
    const dotsContainer = document.getElementById('promo-dots');
    if (!slider || !dotsContainer) return;

    if (promotions.length === 0) {
        // หากยังไม่มีภาพโปรโมชั่นในระบบ จะโชว์ภาพเริ่มต้น
        slider.innerHTML = `
            <div class="min-w-full h-full flex items-center justify-center bg-[#f5f5f5] cursor-pointer" onclick="document.getElementById('shop-section').scrollIntoView({behavior: 'smooth'});">
                <img src="image_a3b10d.jpg" alt="Promotion Banner" class="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.02]" onerror="this.src='https://placehold.co/1200x400/f5f5f5/94a3b8?text=SabuyShop+Promotion'" />
            </div>`;
        dotsContainer.innerHTML = '';
        return;
    }

    // สร้างสไลด์ตามข้อมูลรูปที่ได้จากฐานข้อมูล
    slider.innerHTML = promotions.map(promo => `
        <div class="min-w-full h-full relative bg-gray-100 flex items-center justify-center cursor-pointer" onclick="document.getElementById('shop-section').scrollIntoView({behavior: 'smooth'});">
            <img src="${promo.image_url}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.02]" alt="Promotion Banner" />
        </div>
    `).join('');

    // สร้างจุดบอกตำแหน่ง
    dotsContainer.innerHTML = promotions.map((_, i) => `
        <button class="h-2.5 rounded-full transition-all duration-300 ${i === 0 ? 'bg-[#7fad39] w-6' : 'bg-white/70 hover:bg-white w-2.5 shadow-sm'}" onclick="goToPromoSlide(${i})"></button>
    `).join('');

    currentPromoSlide = 0;
    startPromoTimer();
}

window.nextPromoSlide = function() {
    if (promotions.length <= 1) return;
    currentPromoSlide = (currentPromoSlide + 1) % promotions.length;
    updatePromoSliderUI();
    resetPromoTimer();
}

window.prevPromoSlide = function() {
    if (promotions.length <= 1) return;
    currentPromoSlide = (currentPromoSlide - 1 + promotions.length) % promotions.length;
    updatePromoSliderUI();
    resetPromoTimer();
}

window.goToPromoSlide = function(index) {
    currentPromoSlide = index;
    updatePromoSliderUI();
    resetPromoTimer();
}

function updatePromoSliderUI() {
    const slider = document.getElementById('promo-slider');
    const dotsContainer = document.getElementById('promo-dots');
    if (!slider || !dotsContainer) return;

    slider.style.transform = `translateX(-${currentPromoSlide * 100}%)`;
    Array.from(dotsContainer.children).forEach((dot, i) => {
        dot.className = `h-2.5 rounded-full transition-all duration-300 ${i === currentPromoSlide ? 'bg-[#7fad39] w-6' : 'bg-white/70 hover:bg-white w-2.5 shadow-sm'}`;
    });
}

function startPromoTimer() {
    if (promotions.length <= 1) return;
    clearInterval(promoSlideInterval);
    promoSlideInterval = setInterval(window.nextPromoSlide, 4000); // เลื่อนอัตโนมัติทุก 4 วินาที
}

function resetPromoTimer() {
    startPromoTimer();
}

function renderSidebar() {
    const ul = document.getElementById('sidebar-categories');
    let html = `<li><button onclick="setActiveCategory('All')" class="w-full text-left px-6 py-2 hover:text-[#7fad39] transition text-sm ${activeCategory === 'All' ? 'text-[#7fad39] font-bold' : ''}">สินค้าทั้งหมด</button></li>`;
    categories.forEach(cat => {
        html += `<li><button onclick="setActiveCategory('${cat}')" class="w-full text-left px-6 py-2 hover:text-[#7fad39] transition text-sm ${activeCategory === cat ? 'text-[#7fad39] font-bold' : ''}">${cat}</button></li>`;
    });
    ul.innerHTML = html;
}

function renderTabs() {
    const container = document.getElementById('tab-categories');
    let html = `<button onclick="setActiveCategory('All')" class="whitespace-nowrap font-bold transition-colors ${activeCategory === 'All' ? 'text-[#7fad39] border-b-2 border-[#7fad39]' : 'text-gray-500 hover:text-gray-900'}">ทั้งหมด</button>`;
    categories.forEach(cat => {
        html += `<button onclick="setActiveCategory('${cat}')" class="whitespace-nowrap font-bold transition-colors ${activeCategory === cat ? 'text-[#7fad39] border-b-2 border-[#7fad39]' : 'text-gray-500 hover:text-gray-900'}">${cat}</button>`;
    });
    container.innerHTML = html;
}

function createProductCard(product) {
    const isOutOfStock = product.stock <= 0;
    
    let selectedIndex = selectedUnits[product.id] !== undefined ? selectedUnits[product.id] : 0;
    if (!product.units || selectedIndex >= product.units.length) selectedIndex = 0;
    
    const currentUnit = product.units && product.units.length > 0 ? product.units[selectedIndex] : { name: 'ชิ้น', price: product.price || 0 };

    let unitSelectHtml = '';
    if (product.units && product.units.length > 1) {
        const options = product.units.map((u, idx) => 
            `<option value="${idx}" ${idx == selectedIndex ? 'selected' : ''}>${u.name} (฿${Number(u.price).toLocaleString()})</option>`
        ).join('');
        
        unitSelectHtml = `<select class="w-full text-xs md:text-sm border border-gray-200 rounded px-1 py-1 md:px-2 md:py-1.5 outline-none focus:border-[#7fad39] text-center bg-gray-50" onchange="handleUnitSelect('${product.id}', this.value)">${options}</select>`;
    } else {
        unitSelectHtml = `<div class="text-xs md:text-sm text-gray-500 bg-gray-50 py-1 md:py-1.5 rounded border border-transparent">${currentUnit.name}</div>`;
    }

    const displayCode = product.barcode ? product.barcode : '&nbsp;';

    return `
    <div class="group flex flex-col items-center relative border border-gray-100 hover:border-[#7fad39]/30 pb-3 md:pb-4 rounded-xl transition-all shadow-sm hover:shadow-md bg-white overflow-hidden">
        <div class="w-full aspect-[4/3] bg-[#f5f5f5] relative overflow-hidden mb-2 md:mb-4">
            <img src="${product.image_url}" onerror="this.src='https://placehold.co/400x300/f8fafc/94a3b8?text=No+Image'" class="w-full h-full object-cover transition duration-500 group-hover:scale-105 ${isOutOfStock ? 'opacity-50 grayscale' : ''}" />
            ${!isOutOfStock && product.is_hot ? '<div class="absolute top-2 right-2 md:top-3 md:right-3 bg-red-500 text-white text-[10px] md:text-xs font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full shadow-md z-10 animate-pulse">HOT</div>' : ''}
            ${isOutOfStock ? '<div class="absolute top-2 left-2 md:top-3 md:left-3 bg-red-500 text-white text-[10px] md:text-xs font-bold px-2 py-0.5 md:px-3 md:py-1 rounded-sm z-10">SOLD OUT</div>' : ''}
        </div>
        <div class="text-center w-full px-2 md:px-4 flex flex-col flex-1">
            <h6 class="text-gray-400 text-[10px] md:text-xs mb-1 font-mono">${displayCode}</h6>
            <a href="#" class="text-sm md:text-lg text-black font-medium hover:text-[#7fad39] transition line-clamp-2 mb-1 h-10 md:h-14 leading-tight">${product.name}</a>
            
            ${product.web_detail 
                ? `<p class="text-[10px] md:text-xs text-gray-500 line-clamp-2 mb-2 leading-snug text-left w-full h-7 md:h-8" title="${product.web_detail}">${product.web_detail}</p>` 
                : `<div class="h-7 md:h-8 mb-2 w-full"></div>` 
            }

            <div class="mt-auto mb-2 md:mb-3">${unitSelectHtml}</div>
            <div class="flex justify-between items-center w-full mt-1">
                <h5 class="text-base md:text-xl font-bold text-black text-left">฿${Number(currentUnit.price).toLocaleString()}</h5>
                <button onclick="addToCart('${product.id}')" ${isOutOfStock ? 'disabled' : ''} class="w-8 h-8 md:w-10 md:h-10 bg-[#7fad39] rounded-full flex items-center justify-center text-white hover:bg-[#6c9331] disabled:bg-gray-300 transition-colors shadow-sm shrink-0">
                    <i class="fa-solid fa-cart-shopping text-sm md:text-base"></i>
                </button>
            </div>
        </div>
    </div>`;
}

function renderProducts() {
    const hotSection = document.getElementById('hot-products-section');
    const hotGrid = document.getElementById('hot-products-grid');
    
    const filteredHot = products.filter(p => p.is_hot && (
        p.name.toLowerCase().includes(searchQuery) || 
        p.id.toLowerCase().includes(searchQuery) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchQuery))
    ));
    
    if (filteredHot.length > 0) {
        hotSection.classList.remove('hidden');
        hotGrid.innerHTML = filteredHot.map(p => createProductCard(p)).join('');
    } else { hotSection.classList.add('hidden'); }

    const catGrid = document.getElementById('category-products-grid');
    const emptyState = document.getElementById('empty-state');
    const filteredCat = products.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchQuery) || 
                            p.id.toLowerCase().includes(searchQuery) ||
                            (p.barcode && p.barcode.toLowerCase().includes(searchQuery));
        const matchCat = activeCategory === 'All' || p.category === activeCategory;
        return matchSearch && matchCat;
    });

    if (filteredCat.length > 0) {
        emptyState.classList.add('hidden');
        catGrid.innerHTML = filteredCat.map(p => createProductCard(p)).join('');
    } else {
        catGrid.innerHTML = ''; emptyState.classList.remove('hidden');
    }
}

// ==========================================
// 6. ระบบตะกร้า (Cart) และค้นหา (Search)
// ==========================================
window.handleSearch = function(val) { searchQuery = val.toLowerCase(); renderProducts(); }

window.setActiveCategory = function(cat) {
    activeCategory = cat; 
    document.getElementById('category-title').innerText = cat === 'All' ? 'สินค้าทั้งหมด' : cat;
    renderSidebar(); renderTabs(); renderProducts();
    
    // 🌟 หุบเมนูอัตโนมัติบน iPad และหน้าจอมือถือ หลังจากที่ลูกค้ากดเลือกหมวดหมู่เสร็จ
    if (window.innerWidth < 1024) {
        const menu = document.getElementById('sidebar-categories');
        const chevron = document.getElementById('category-chevron');
        if (menu && chevron) {
            menu.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    }
}

window.handleUnitSelect = function(productId, unitType) {
    selectedUnits[productId] = parseInt(unitType);
    renderProducts(); 
}

window.addToCart = function(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    let selectedIndex = selectedUnits[product.id] !== undefined ? selectedUnits[product.id] : 0;
    if (!product.units || selectedIndex >= product.units.length) selectedIndex = 0;
    
    const currentUnit = product.units && product.units.length > 0 ? product.units[selectedIndex] : { name: 'ชิ้น', price: product.price || 0 };
    
    const cartItemId = `${product.id}-${selectedIndex}`;
    
    const existing = cart.find(item => item.cartItemId === cartItemId);
    if (existing) { existing.qty += 1; } 
    else {
        cart.push({ ...product, cartItemId: cartItemId, unitType: selectedIndex, price: currentUnit.price, unitName: currentUnit.name, qty: 1 });
    }
    updateCartUI();
}

window.updateQty = function(cartItemId, delta) {
    const item = cart.find(i => i.cartItemId === cartItemId);
    if (item) { item.qty = Math.max(1, item.qty + delta); updateCartUI(); }
}

window.removeFromCart = function(cartItemId) { cart = cart.filter(item => item.cartItemId !== cartItemId); updateCartUI(); }

function updateCartUI() {
    const cartBadge = document.getElementById('cart-badge');
    const cartHeaderTotal = document.getElementById('cart-header-total');
    const cartEmpty = document.getElementById('cart-empty');
    const cartItemsList = document.getElementById('cart-items');
    const cartFooter = document.getElementById('cart-footer');
    const cartTotalEl = document.getElementById('cart-total');
    const floatingCartBadge = document.getElementById('floating-cart-badge');

    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);

    if (totalQty > 0) { 
        cartBadge.innerText = totalQty; 
        cartBadge.classList.remove('hidden'); 
        if (floatingCartBadge) {
            floatingCartBadge.innerText = totalQty;
            floatingCartBadge.classList.remove('hidden');
        }
    } else { 
        cartBadge.classList.add('hidden'); 
        if (floatingCartBadge) {
            floatingCartBadge.classList.add('hidden');
        }
    }
    cartHeaderTotal.innerText = `฿${totalAmount.toLocaleString()}`;

    if (cart.length === 0) {
        cartEmpty.style.display = 'flex'; cartItemsList.innerHTML = ''; cartFooter.classList.add('hidden');
    } else {
        cartEmpty.style.display = 'none'; cartFooter.classList.remove('hidden');
        cartItemsList.innerHTML = cart.map(item => `
            <li class="flex gap-3 md:gap-4 p-3 md:p-4 border border-gray-100 rounded-lg shadow-sm">
                <img src="${item.image_url}" onerror="this.src='https://placehold.co/400x300/f8fafc/94a3b8'" class="w-16 h-16 md:w-20 md:h-20 object-cover bg-gray-50 rounded" />
                <div class="flex-1 flex flex-col justify-between">
                    <div>
                        <h4 class="font-bold text-sm md:text-base text-black line-clamp-1">${item.name}</h4>
                        <span class="text-[10px] md:text-xs text-[#7fad39] font-bold bg-green-50 px-2 py-0.5 rounded">${item.unitName}</span>
                    </div>
                    <div class="flex justify-between items-center mt-2">
                        <span class="font-bold text-[#7fad39]">฿${(item.price * item.qty).toLocaleString()}</span>
                        <div class="flex items-center gap-1 md:gap-2 bg-gray-100 p-1 rounded">
                            <button onclick="updateQty('${item.cartItemId}', -1)" class="p-1 hover:bg-white rounded"><i class="fa-solid fa-minus text-xs"></i></button>
                            <span class="text-xs md:text-sm w-5 md:w-6 text-center font-bold">${item.qty}</span>
                            <button onclick="updateQty('${item.cartItemId}', 1)" class="p-1 hover:bg-white rounded"><i class="fa-solid fa-plus text-xs"></i></button>
                        </div>
                    </div>
                </div>
                <button onclick="removeFromCart('${item.cartItemId}')" class="text-gray-400 hover:text-red-500 self-start p-1"><i class="fa-solid fa-xmark"></i></button>
            </li>
        `).join('');
        cartTotalEl.innerText = `฿${totalAmount.toLocaleString()}`;
    }
}

// ==========================================
// 7. UI เปิด/ปิด ตะกร้า & ออกบิลส่ง LINE
// ==========================================
window.openCart = function() {
    document.getElementById('cart-drawer').classList.remove('hidden');
    setTimeout(() => { document.getElementById('cart-overlay').classList.remove('opacity-0'); document.getElementById('cart-content').classList.remove('translate-x-full'); }, 10);
}

window.closeCart = function() {
    document.getElementById('cart-overlay').classList.add('opacity-0'); document.getElementById('cart-content').classList.add('translate-x-full');
    setTimeout(() => { document.getElementById('cart-drawer').classList.add('hidden'); }, 300);
}

window.checkoutViaLine = function() {
    if (cart.length === 0) return;
    let orderText = `🛒 *สั่งซื้อสินค้าจากเว็บ*\n\n`;
    cart.forEach((item, index) => { 
        const codeLine = item.barcode ? `บาร์โค้ด: ${item.barcode}` : `รหัส: ${item.id}`;
        orderText += `${index + 1}. ${item.name}\n   ${codeLine}\n   จำนวน: ${item.qty} ${item.unitName} (฿${(item.price * item.qty).toLocaleString()})\n\n`; 
    });
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    orderText += `💰 *ยอดรวมทั้งสิ้น: ฿${totalAmount.toLocaleString()}*\n\nรบกวนแอดมินสรุปยอดให้ด้วยครับ/ค่ะ`;
    const encodedText = encodeURIComponent(orderText);
    window.open(`https://line.me/R/oaMessage/${LINE_OA_ID}/?${encodedText}`, '_blank');
}

// ==========================================
// 🌟 8. ระบบปุ่มลอย (Floating Buttons)
// ==========================================
window.goHomeAndScrollTop = function() {
    setActiveCategory('All');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('scroll', () => {
    const homeBtn = document.getElementById('floating-home-btn');
    if (homeBtn) {
        if (window.scrollY > 200) {
            homeBtn.classList.remove('hidden');
            homeBtn.classList.add('flex');
        } else {
            homeBtn.classList.add('hidden');
            homeBtn.classList.remove('flex');
        }
    }
});

// 🌟 9. ดักจับการย่อ-ขยายหน้าจอ (Resize Event) 
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
    // ถ้าหน้าจอถูกขยายเป็นคอมพิวเตอร์ (>= 1024px)
    if (window.innerWidth >= 1024 && lastWidth < 1024) {
        const menu = document.getElementById('sidebar-categories');
        const chevron = document.getElementById('category-chevron');
        if (menu && chevron) {
            menu.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
        }
    } 
    // ถ้าหน้าจอถูกย่อเป็น iPad หรือมือถือ (< 1024px)
    else if (window.innerWidth < 1024 && lastWidth >= 1024) {
        const menu = document.getElementById('sidebar-categories');
        const chevron = document.getElementById('category-chevron');
        if (menu && chevron) {
            menu.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    }
    lastWidth = window.innerWidth;
});

// 🚀 สั่งเริ่มทำงานเมื่อไฟล์โหลดเสร็จ
fetchProductsFromCloud();
