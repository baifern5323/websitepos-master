// ==========================================
// 1. ตั้งค่าร้านค้าและการเชื่อมต่อ (CONFIG)
// ==========================================
let currentLineId = "";
let currentShippingTiers = [{ min_amount: 0, fee: 50 }, { min_amount: 500, fee: 0 }];

// ⚠️ ใส่ Supabase URL และ Key 
const SUPABASE_URL = 'https://xpetiobkllituiewqkos.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vZKcLK-PW_SVleLuJMmnjw_3ApwNLOf';
const liffId = '2009669752-FDsRcno0'; // 🌟 LINE LIFF ID
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. ตัวแปรเก็บข้อมูล (STATE)
// ==========================================
let products = [];
let categories = [];
let cart = [];
let promotions = [];
let activeCategory = 'All';
let searchQuery = '';
let selectedUnits = {};

let currentPage = 1;
const itemsPerPage = 20;

let currentPromoSlide = 0;
let promoSlideInterval;

// ==========================================
// 3. การแสดงผลหมวดหมู่ด้านซ้าย
// ==========================================
window.toggleCategories = function () {
    if (window.innerWidth >= 1024) return;
    const menu = document.getElementById('sidebar-categories');
    const chevron = document.getElementById('category-chevron');
    if (menu && chevron) {
        menu.classList.toggle('hidden');
        chevron.style.transform = menu.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
}

// ==========================================
// 4. โหลดข้อมูลจาก Supabase
// ==========================================
async function fetchProductsFromCloud() {
    try {
        if (SUPABASE_KEY.includes('ใส่คีย์_ANON')) {
            console.log("⚠️ API Key ผิดพลาด");
            document.getElementById('loading-spinner').style.display = 'none';
            return;
        }

        // --- 4.1 ดึงสินค้าหลักและหน่วย ---
        let combinedProducts = [];
        const { data: productData } = await supabaseClient.from('products').select(`*, product_groups (name), product_units (*)`);

        if (productData && productData.length > 0) {
            const activeData = productData.filter(p => p.status !== 1 && p.show_on_web === true);
            const standardProducts = activeData.map(p => {
                let units = [];
                // 1. หน่วยย่อยสุด (Smallest Unit)
                if (p.web_show_s_unit && p.price1 > 0) units.push({ name: p.s_unit ? p.s_unit.trim() : 'ชิ้น', price: p.price1, rate: 1 });

                // 2. หน่วยขายส่ง (Bulk Units)
                if (p.web_show_l_unit && p.product_units && p.product_units.length > 0) {
                    p.product_units.forEach(u => {
                        // หน่วยกลาง (M Unit)
                        if (u.m_unit && u.price2 > 0 && !units.find(x => x.name === u.m_unit.trim())) {
                            let mRate = (Number(u.num_s_per_l_unit) / Number(u.num_m_per_l_unit)) || Number(u.num_m_per_l_unit) || 0;
                            if (mRate > 1) units.push({ name: u.m_unit.trim(), price: u.price2, rate: mRate });
                        }
                        // หน่วยใหญ่ (L Unit)
                        if (u.l_unit && u.price1 > 0 && !units.find(x => x.name === u.l_unit.trim())) {
                            units.push({ name: u.l_unit.trim(), price: u.price1, rate: Number(u.num_s_per_l_unit) || 0 });
                        }
                    });
                }

                // 🌟 สั่งเรียงลำดับจาก "น้อยไปมาก" (ตามจำนวนคูณ)
                units.sort((a, b) => (a.rate || 0) - (b.rate || 0));

                return { id: p.pn, barcode: p.barcode, name: p.name, price: p.price1, stock: p.stock, image_url: p.image_url, web_detail: p.web_detail, category: p.product_groups ? p.product_groups.name : 'ไม่มีหมวดหมู่', is_hot: p.is_hot, units: units };
            });
            combinedProducts = [...combinedProducts, ...standardProducts];
        }

        // --- 4.2 ดึงสินค้าชุด ---
        const { data: setData } = await supabaseClient.from('product_sets').select('*');
        if (setData && setData.length > 0) {
            const activeSets = setData.filter(p => p.status !== 1 && p.is_hot === true);
            const setProducts = activeSets.map(p => ({
                id: `SET_${p.psn}`, barcode: p.barcode, name: p.name, price: p.price1, stock: 999, image_url: p.image_url, web_detail: 'สินค้าจัดเซ็ตสุดคุ้ม', category: 'สินค้าจัดเซ็ต', is_hot: p.is_hot, units: [{ name: p.unit ? p.unit.trim() : 'ชุด', price: p.price1 }]
            }));
            combinedProducts = [...combinedProducts, ...setProducts];
        }

        if (combinedProducts.length > 0) {
            products = combinedProducts.filter(p => p.units.length > 0).sort((a, b) => a.name.localeCompare(b.name, 'th'));
        }

        // --- 4.3 ดึงโปรโมชั่น ---
        const { data: promoData } = await supabaseClient.from('promotions').select('*').eq('is_active', true).order('sort_order', { ascending: true });
        if (promoData) promotions = promoData;

        // --- 4.4 ดึงข้อมูลร้านค้า, ค่าจัดส่ง และการติดต่อ ---
        const { data: companyData } = await supabaseClient.from('company_profile').select('*').order('updated_at', { ascending: false }).limit(1);
        if (companyData && companyData.length > 0) {
            const company = companyData[0];

            if (company.shipping_tiers) {
                let parsedTiers = typeof company.shipping_tiers === 'string' ? JSON.parse(company.shipping_tiers) : company.shipping_tiers;
                if (Array.isArray(parsedTiers) && parsedTiers.length > 0) {
                    currentShippingTiers = parsedTiers.sort((a, b) => b.min_amount - a.min_amount);
                }
            }

            if (company.line_id && company.line_id.trim() !== '') currentLineId = company.line_id.trim();
            if (company.email && document.getElementById('footer-company-email')) document.getElementById('footer-company-email').innerText = company.email;

            // 🌟 อัปเดตเบอร์โทรศัพท์ทั้ง Header และ Footer
            if (company.phone) {
                const headerPhone = document.getElementById('header-company-phone');
                if (headerPhone) headerPhone.innerText = company.phone;

                const footerPhone = document.getElementById('footer-company-phone');
                if (footerPhone) footerPhone.innerText = company.phone;
            }

            const shopName = company.name || 'SabuyShop';
            if (document.getElementById('header-company-name')) document.getElementById('header-company-name').innerText = shopName;
            if (document.getElementById('footer-company-name')) document.getElementById('footer-company-name').innerText = shopName;

            if (company.logo_url && company.logo_url.trim() !== '') {
                const logo = document.getElementById('header-company-logo');
                if (logo) { logo.src = company.logo_url; logo.classList.remove('hidden'); }
            }

            // จัดการแสดงผล QR Code LINE
            const lineBox = document.getElementById('footer-contact-box');
            let hasLineInfo = false;
            if (company.line_qr_url && company.line_qr_url.trim() !== '') {
                const qr = document.getElementById('footer-line-qr');
                if (qr) { qr.src = company.line_qr_url; qr.classList.remove('hidden'); hasLineInfo = true; }
            }
            if (company.line_url && company.line_url.trim() !== '') {
                const link = document.getElementById('footer-line-link');
                if (link) { link.href = company.line_url; link.classList.remove('hidden'); link.classList.add('inline-flex'); hasLineInfo = true; }
            }
            if (hasLineInfo && lineBox) lineBox.classList.remove('hidden');
        }

        initializeLiff(); // 🌟 เริ่มการทำงานของ LINE LIFF
        init();
    } catch (err) {
        console.error("Fetch Error:", err);
        document.getElementById('loading-spinner').style.display = 'none';
    }
}

// ==========================================
// 5. ระบบ Render หน้าจอ (UI)
// ==========================================
function init() {
    categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
    document.getElementById('loading-spinner').style.display = 'none';

    const catGrid = document.getElementById('category-products-grid');
    if (catGrid) {
        catGrid.className = 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6';
        catGrid.classList.remove('hidden');
    }

    const menu = document.getElementById('sidebar-categories');
    const chevron = document.getElementById('category-chevron');
    if (menu && chevron) {
        if (window.innerWidth >= 1024) {
            menu.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
        } else {
            menu.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    renderPromotions();
    renderSidebar();
    renderTabs();
    renderProducts();

    enableMouseDrag('hot-products-grid');
    enableMouseDrag('tab-categories');
}

function enableMouseDrag(elementId) {
    const slider = document.getElementById(elementId);
    if (!slider) return;

    let isDown = false, startX, scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        if (e.button === 1) e.preventDefault();
        isDown = true; slider.style.cursor = 'grabbing'; slider.style.scrollSnapType = 'none';
        startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft;
    });

    slider.addEventListener('mouseleave', () => { isDown = false; slider.style.cursor = 'grab'; slider.style.scrollSnapType = 'x mandatory'; });
    slider.addEventListener('mouseup', () => { isDown = false; slider.style.cursor = 'grab'; slider.style.scrollSnapType = 'x mandatory'; });
    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return; e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5;
        slider.scrollLeft = scrollLeft - walk;
    });
    slider.style.cursor = 'grab';
}

function renderPromotions() {
    const slider = document.getElementById('promo-slider');
    const dotsContainer = document.getElementById('promo-dots');
    if (!slider || !dotsContainer) return;

    if (promotions.length === 0) {
        slider.innerHTML = `<div class="min-w-full h-full flex items-center justify-center bg-gray-200"><span class="text-gray-400">ยังไม่มีโปรโมชั่น</span></div>`;
        dotsContainer.innerHTML = '';
        return;
    }

    slider.innerHTML = promotions.map(promo => `
        <div class="min-w-full h-full relative bg-gray-100 flex items-center justify-center cursor-pointer" onclick="document.getElementById('shop-section').scrollIntoView({behavior: 'smooth'});">
            <img src="${promo.image_url}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.02]" />
        </div>
    `).join('');

    dotsContainer.innerHTML = promotions.map((_, i) => `
        <button class="h-2.5 rounded-full transition-all duration-300 ${i === 0 ? 'bg-[#7fad39] w-6' : 'bg-white/70 w-2.5 shadow-sm'}" onclick="goToPromoSlide(${i})"></button>
    `).join('');

    currentPromoSlide = 0; startPromoTimer();
}

window.nextPromoSlide = function () {
    if (promotions.length <= 1) return;
    currentPromoSlide = (currentPromoSlide + 1) % promotions.length;
    updatePromoSliderUI(); resetPromoTimer();
}

window.prevPromoSlide = function () {
    if (promotions.length <= 1) return;
    currentPromoSlide = (currentPromoSlide - 1 + promotions.length) % promotions.length;
    updatePromoSliderUI(); resetPromoTimer();
}

window.goToPromoSlide = function (index) {
    currentPromoSlide = index; updatePromoSliderUI(); resetPromoTimer();
}

function updatePromoSliderUI() {
    const slider = document.getElementById('promo-slider');
    const dotsContainer = document.getElementById('promo-dots');
    if (!slider || !dotsContainer) return;

    slider.style.transform = `translateX(-${currentPromoSlide * 100}%)`;
    Array.from(dotsContainer.children).forEach((dot, i) => {
        dot.className = `h-2.5 rounded-full transition-all duration-300 ${i === currentPromoSlide ? 'bg-[#7fad39] w-6' : 'bg-white/70 w-2.5 shadow-sm'}`;
    });
}

function startPromoTimer() {
    if (promotions.length <= 1) return;
    clearInterval(promoSlideInterval);
    promoSlideInterval = setInterval(window.nextPromoSlide, 4000);
}
function resetPromoTimer() { startPromoTimer(); }

function renderSidebar() {
    const ul = document.getElementById('sidebar-categories');
    if (!ul) return;
    let html = `<li><button onclick="setActiveCategory('All')" class="w-full text-left px-6 py-3 hover:text-[#7fad39] transition text-base ${activeCategory === 'All' ? 'text-[#7fad39] font-bold bg-green-50 border-l-4 border-[#7fad39]' : 'text-gray-600 border-l-4 border-transparent'}">สินค้าทั้งหมด</button></li>`;

    categories.forEach(cat => {
        const isSpecial = cat === 'สินค้าจัดเซ็ต';
        let textClass = activeCategory === cat
            ? (isSpecial ? 'text-orange-600 font-extrabold bg-orange-50 border-l-4 border-orange-500' : 'text-[#7fad39] font-bold bg-green-50 border-l-4 border-[#7fad39]')
            : (isSpecial ? 'text-orange-500 font-bold hover:bg-orange-50 hover:text-orange-600 border-l-4 border-transparent' : 'text-gray-600 hover:text-[#7fad39] hover:bg-gray-50 border-l-4 border-transparent');

        const icon = isSpecial ? '<i class="fa-solid fa-gift mr-2 animate-pulse text-lg"></i>' : '';
        html += `<li><button onclick="setActiveCategory('${cat}')" class="w-full text-left px-6 py-3 transition text-base ${textClass}">${icon}${cat}</button></li>`;
    });
    ul.innerHTML = html;
}

function renderTabs() {
    const container = document.getElementById('tab-categories');
    if (!container) return;
    let html = `<button onclick="setActiveCategory('All')" class="whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all duration-300 shadow-sm flex-shrink-0 ${activeCategory === 'All' ? 'bg-[#7fad39] text-white border-[#7fad39]' : 'bg-white text-gray-600 border-gray-200'}">ทั้งหมด</button>`;

    categories.forEach(cat => {
        const isSpecial = cat === 'สินค้าจัดเซ็ต';
        let btnClass = activeCategory === cat
            ? (isSpecial ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white border-transparent' : 'bg-[#7fad39] text-white border-[#7fad39]')
            : (isSpecial ? 'bg-orange-50 text-orange-600 border-orange-300' : 'bg-white text-gray-600 border-gray-200');

        const icon = isSpecial ? '<i class="fa-solid fa-gift mr-1"></i> ' : '';
        html += `<button onclick="setActiveCategory('${cat}')" class="whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all duration-300 shadow-sm flex-shrink-0 ${btnClass}">${icon}${cat}</button>`;
    });
    container.innerHTML = html;
}

function createProductCard(product) {
    let selectedIndex = selectedUnits[product.id] || 0;
    const currentUnit = product.units[selectedIndex] || { name: 'ชิ้น', price: product.price || 0 };

    let unitSelectHtml = product.units.length > 1
        ? `<select class="w-full text-xs md:text-sm border border-gray-200 rounded px-1 py-1 md:px-2 md:py-1.5 outline-none focus:border-[#7fad39] text-center bg-gray-50" onchange="handleUnitSelect('${product.id}', this.value)">${product.units.map((u, idx) => `<option value="${idx}" ${idx == selectedIndex ? 'selected' : ''}>${u.name} (฿${Number(u.price).toLocaleString()})</option>`).join('')}</select>`
        : `<div class="text-xs md:text-sm text-gray-500 bg-gray-50 py-1 md:py-1.5 rounded border border-transparent">${currentUnit.name}</div>`;

    return `
    <div class="group flex flex-col items-center relative pb-3 md:pb-4 rounded-xl transition-all overflow-hidden w-full h-full ${product.is_hot ? 'border-2 border-red-400 shadow-md bg-gradient-to-b from-red-50/30 to-white' : 'border border-gray-100 bg-white hover:border-[#7fad39]/30 shadow-sm'}">
        <div class="w-full aspect-[4/3] bg-[#f5f5f5] relative overflow-hidden mb-2 md:mb-4">
            <img src="${product.image_url}" onerror="this.src='https://placehold.co/400x300/f8fafc/94a3b8?text=No+Image'" class="w-full h-full object-cover transition duration-500 group-hover:scale-105" />
            ${product.is_hot ? '<div class="absolute top-2 right-2 md:top-3 md:right-3 bg-red-500 text-white text-[10px] md:text-xs font-black px-2 py-1 rounded-full shadow-md z-10 animate-pulse">HOT</div>' : ''}
        </div>
        <div class="text-center w-full px-2 md:px-4 flex flex-col flex-1">
            <h6 class="text-gray-400 text-[10px] md:text-xs mb-1 font-mono">${product.barcode || product.id}</h6>
            <a href="#" class="text-sm md:text-lg text-black font-medium hover:text-[#7fad39] line-clamp-2 mb-1 h-10 md:h-14 leading-tight">${product.name}</a>
            <div class="mt-auto mb-2 md:mb-3">${unitSelectHtml}</div>
            <div class="flex justify-between items-center w-full mt-1">
                <h5 class="text-base md:text-xl font-bold ${product.is_hot ? 'text-red-600' : 'text-black'} text-left">฿${Number(currentUnit.price).toLocaleString()}</h5>
                <button onclick="addToCart('${product.id}')" class="w-8 h-8 md:w-10 md:h-10 ${product.is_hot ? 'bg-red-500' : 'bg-[#7fad39]'} rounded-full flex items-center justify-center text-white shadow-sm shrink-0">
                    <i class="fa-solid fa-cart-shopping"></i>
                </button>
            </div>
        </div>
    </div>`;
}

function renderProducts() {
    const hotSection = document.getElementById('hot-products-section');
    const hotGrid = document.getElementById('hot-products-grid');

    // 🌟 แก้ไข: ค้นหาจาก name และ barcode (ลบการค้นหาด้วย ID ออก)
    const filteredHot = products.filter(p => p.is_hot && (
        p.name.toLowerCase().includes(searchQuery) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchQuery))
    ));

    if (filteredHot.length > 0) {
        if (hotSection) hotSection.classList.remove('hidden');
        if (hotGrid) hotGrid.innerHTML = filteredHot.map(p => `<div class="w-[160px] md:w-[240px] shrink-0 snap-start flex">${createProductCard(p)}</div>`).join('');
    } else {
        if (hotSection) hotSection.classList.add('hidden');
    }

    const catGrid = document.getElementById('category-products-grid');
    const emptyState = document.getElementById('empty-state');
    const paginationContainer = document.getElementById('pagination-controls');

    // 🌟 แก้ไข: ค้นหาจาก name และ barcode (ลบการค้นหาด้วย ID ออก)
    const filteredCat = products.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchQuery) ||
            (p.barcode && p.barcode.toLowerCase().includes(searchQuery));
        const matchCat = activeCategory === 'All' || p.category === activeCategory;
        return matchSearch && matchCat;
    });

    if (filteredCat.length > 0) {
        if (emptyState) emptyState.classList.add('hidden');
        if (catGrid) {
            catGrid.classList.remove('hidden');
            const totalPages = Math.ceil(filteredCat.length / itemsPerPage);
            const startIndex = (currentPage - 1) * itemsPerPage;
            catGrid.innerHTML = filteredCat.slice(startIndex, startIndex + itemsPerPage).map(p => createProductCard(p)).join('');
            renderPagination(totalPages);
        }
    } else {
        if (catGrid) { catGrid.innerHTML = ''; catGrid.classList.add('hidden'); }
        if (emptyState) emptyState.classList.remove('hidden');
        if (paginationContainer) paginationContainer.classList.add('hidden');
    }
}

function renderPagination(totalPages) {
    const container = document.getElementById('pagination-controls');
    if (!container) return;
    if (totalPages <= 1) { container.classList.add('hidden'); return; }

    container.classList.remove('hidden');
    let html = `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${currentPage === 1 ? 'opacity-50 bg-gray-50' : 'bg-white hover:bg-[#7fad39] hover:text-white'}"><i class="fa-solid fa-chevron-left"></i></button>`;

    let startP = Math.max(1, currentPage - 2);
    let endP = Math.min(totalPages, startP + 4);
    if (endP - startP < 4) startP = Math.max(1, endP - 4);

    for (let i = startP; i <= endP; i++) {
        html += `<button onclick="changePage(${i})" class="w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${i === currentPage ? 'bg-[#7fad39] text-white font-bold' : 'bg-white hover:bg-[#7fad39] hover:text-white'}">${i}</button>`;
    }
    html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${currentPage === totalPages ? 'opacity-50 bg-gray-50' : 'bg-white hover:bg-[#7fad39] hover:text-white'}"><i class="fa-solid fa-chevron-right"></i></button>`;
    container.innerHTML = html;
}

window.changePage = function (page) {
    currentPage = page; renderProducts();
    const title = document.getElementById('category-title');
    if (title) window.scrollTo({ top: title.getBoundingClientRect().top + window.pageYOffset - 140, behavior: 'smooth' });
}

// ==========================================
// 6. การทำงานอื่นๆ (Cart, Search, Categories)
// ==========================================
window.handleSearch = function (val) { searchQuery = val.toLowerCase(); currentPage = 1; renderProducts(); }

window.setActiveCategory = function (cat) {
    activeCategory = cat; currentPage = 1;
    document.getElementById('category-title').innerText = cat === 'All' ? 'สินค้าทั้งหมด' : cat;
    renderSidebar(); renderTabs(); renderProducts();

    if (window.innerWidth < 1024) {
        document.getElementById('sidebar-categories')?.classList.add('hidden');
        document.getElementById('category-chevron').style.transform = 'rotate(0deg)';
    }
    const title = document.getElementById('category-title');
    if (title) window.scrollTo({ top: title.getBoundingClientRect().top + window.pageYOffset - 140, behavior: 'smooth' });
}

window.handleUnitSelect = function (productId, unitType) { selectedUnits[productId] = parseInt(unitType); renderProducts(); }

window.addToCart = function (productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const selectedIndex = selectedUnits[product.id] || 0;
    const unit = product.units[selectedIndex];
    const cartItemId = `${product.id}-${selectedIndex}`;
    const existing = cart.find(item => item.cartItemId === cartItemId);

    if (existing) existing.qty += 1;
    else cart.push({ ...product, cartItemId, unitType: selectedIndex, price: unit.price, unitName: unit.name, qty: 1 });
    updateCartUI();
}

window.updateQty = function (id, delta) { const item = cart.find(i => i.cartItemId === id); if (item) { item.qty = Math.max(1, item.qty + delta); updateCartUI(); } }
window.removeFromCart = function (id) { cart = cart.filter(item => item.cartItemId !== id); updateCartUI(); }

function updateCartUI() {
    const badge = document.getElementById('cart-badge'), floatBadge = document.getElementById('floating-cart-badge');
    const list = document.getElementById('cart-items'), footer = document.getElementById('cart-footer'), empty = document.getElementById('cart-empty');

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);

    let shippingFee = 0;
    let nextTierForPromo = null;

    if (subtotal > 0 && currentShippingTiers.length > 0) {
        const applicable = currentShippingTiers.find(t => subtotal >= t.min_amount);
        shippingFee = applicable ? applicable.fee : currentShippingTiers[currentShippingTiers.length - 1].fee;
        const sorted = [...currentShippingTiers].sort((a, b) => a.min_amount - b.min_amount);
        nextTierForPromo = sorted.find(t => t.min_amount > subtotal && t.fee < shippingFee);
    }
    const totalAmount = subtotal + shippingFee;

    if (totalQty > 0) { badge.innerText = totalQty; badge.classList.remove('hidden'); floatBadge.innerText = totalQty; floatBadge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); floatBadge.classList.add('hidden'); }

    document.getElementById('cart-header-total').innerText = `฿${totalAmount.toLocaleString()}`;

    if (cart.length === 0) {
        empty.style.display = 'flex'; list.innerHTML = ''; footer.classList.add('hidden'); footer.classList.remove('flex');
    } else {
        empty.style.display = 'none'; footer.classList.remove('hidden'); footer.classList.add('flex');
        list.innerHTML = cart.map(item => `
            <li class="flex gap-3 bg-white border border-gray-100 rounded-xl shadow-sm p-3">
                <img src="${item.image_url}" class="w-16 h-16 object-cover rounded-lg" />
                <div class="flex-1 flex flex-col justify-between">
                    <h4 class="font-bold text-sm line-clamp-1">${item.name}</h4>
                    <div class="flex justify-between items-center mt-2">
                        <span class="font-bold text-[#7fad39]">฿${(item.price * item.qty).toLocaleString()}</span>
                        <div class="flex items-center gap-2 bg-gray-50 p-1 rounded-lg">
                            <button onclick="updateQty('${item.cartItemId}', -1)" class="w-6 h-6 bg-white rounded shadow-sm text-gray-500"><i class="fa-solid fa-minus text-[10px]"></i></button>
                            <span class="text-xs font-bold w-4 text-center">${item.qty}</span>
                            <button onclick="updateQty('${item.cartItemId}', 1)" class="w-6 h-6 bg-white rounded shadow-sm text-gray-500"><i class="fa-solid fa-plus text-[10px]"></i></button>
                        </div>
                    </div>
                </div>
                <button onclick="removeFromCart('${item.cartItemId}')" class="p-1 text-gray-300 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
            </li>
        `).join('');

        document.getElementById('cart-subtotal').innerText = `฿${subtotal.toLocaleString()}`;
        document.getElementById('cart-total').innerText = `฿${totalAmount.toLocaleString()}`;

        const shipEl = document.getElementById('cart-shipping');
        shipEl.innerText = shippingFee === 0 ? 'ส่งฟรี' : `฿${shippingFee.toLocaleString()}`;
        shipEl.className = shippingFee === 0 ? 'text-[#7fad39] font-bold' : 'text-gray-600';

        const promoEl = document.getElementById('cart-free-shipping-text');
        if (shippingFee === 0) { promoEl.innerText = 'จัดส่งฟรี!'; promoEl.className = "text-[10px] bg-green-50 text-[#7fad39] px-1.5 py-0.5 rounded font-bold"; promoEl.classList.remove('hidden'); }
        else if (nextTierForPromo) {
            const diff = nextTierForPromo.min_amount - subtotal;
            promoEl.innerText = `ซื้อเพิ่ม ${diff.toLocaleString()}.- ${nextTierForPromo.fee === 0 ? 'ส่งฟรี' : `ค่าส่งเหลือ ฿${nextTierForPromo.fee}`}`;
            promoEl.className = "text-[10px] bg-orange-50 text-orange-500 px-1.5 py-0.5 rounded font-bold animate-pulse";
            promoEl.classList.remove('hidden');
        } else { promoEl.classList.add('hidden'); }
    }
}

window.openCart = function () { document.getElementById('cart-drawer').classList.remove('hidden'); setTimeout(() => { document.getElementById('cart-overlay').classList.remove('opacity-0'); document.getElementById('cart-content').classList.remove('translate-x-full'); }, 10); }
window.closeCart = function () { document.getElementById('cart-overlay').classList.add('opacity-0'); document.getElementById('cart-content').classList.add('translate-x-full'); setTimeout(() => document.getElementById('cart-drawer').classList.add('hidden'), 300); }
window.clearSearchAndGoHome = function () { document.getElementById('search-input').value = ''; searchQuery = ''; setActiveCategory('All'); window.scrollTo({ top: 0, behavior: 'smooth' }); }

// ==========================================
// 7. ระบบ LINE LIFF (ดึงข้อมูลอัตโนมัติ)
// ==========================================
async function initializeLiff() {
    try {
        await liff.init({ liffId: liffId });
        if (liff.isLoggedIn()) {
            const profile = await liff.getProfile();
            const idInput = document.getElementById('customer-line-id');
            const nameInput = document.getElementById('customer-name');
            const profileImg = document.getElementById('line-profile-img');
            const profileName = document.getElementById('line-profile-name');
            const profileBox = document.getElementById('line-profile-box');

            if (idInput) {
                idInput.value = profile.displayName; 
                idInput.readOnly = true;
                idInput.classList.add('bg-gray-100');
            }
            if (nameInput && !nameInput.value) nameInput.value = profile.displayName;
            if (profileImg) profileImg.src = profile.pictureUrl;
            if (profileName) profileName.innerText = profile.displayName;
            if (profileBox) profileBox.classList.remove('hidden');

            // 🌟 ดึงข้อมูลเก่าจาก Supabase (ถ้ามี) โดยค้นหาจากชื่อ LINE
            fetchCustomerHistory(profile.displayName);
        } else {
            // ปรับปรุง: ไม่บังคับ Login ทันทีเพื่อให้ลูกค้าเห็นหน้า Index ก่อนตามที่คุณต้องการ
            // ระบบจะไปขอ Login อีกครั้งตอนที่ลูกค้ากดปุ่ม "ยืนยันสั่งซื้อ" ครับ
            console.log("LINE LIFF: Not logged in. User can browse index.");
        }
    } catch (err) {
        console.error("LIFF Init Error:", err);
    }
}

async function fetchCustomerHistory(lineName) {
    try {
        const { data, error } = await supabaseClient.from('customers').select('*').eq('line_id', lineName).single();
        if (data && !error) {
            const phoneInput = document.getElementById('customer-phone');
            const addressInput = document.getElementById('customer-address');
            if (phoneInput && !phoneInput.value) phoneInput.value = data.phone;
            if (addressInput && !addressInput.value) addressInput.value = data.address;
        }
    } catch (err) { console.error("History Error:", err); }
}

window.checkoutViaLine = async function () {
    if (cart.length === 0) return;

    // ตรวจสอบล็อกอินอีกรอบเพื่อความมั่นใจ
    if (!liff.isLoggedIn()) {
        liff.login();
        return;
    }

    const profile = await liff.getProfile();
    const userId = profile.userId;

    const lineId = document.getElementById('customer-line-id')?.value.trim();
    const name = document.getElementById('customer-name')?.value.trim();
    const phone = document.getElementById('customer-phone')?.value.trim();
    const address = document.getElementById('customer-address')?.value.trim();
    const err = document.getElementById('checkout-error');

    if (!lineId || !name || !phone) {
        if (err) { err.innerText = " กรุณากรอก 'ชื่อ LINE', 'ชื่อ-สกุล' และ 'เบอร์โทร' ให้ครบถ้วน"; err.classList.remove('hidden'); }
        return;
    }
    if (err) err.classList.add('hidden');

    if (!currentLineId) { alert('ร้านค้ายังไม่ตั้งค่า LINE สำหรับรับออเดอร์'); return; }

    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const tier = currentShippingTiers.find(t => sub >= t.min_amount);
    const fee = tier ? tier.fee : currentShippingTiers[currentShippingTiers.length - 1].fee;
    const total = sub + fee;

    // เตรียมข้อมูลสินค้าเพื่อส่งไปที่ API
    const itemsData = cart.map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        unit: item.unitName,
        total: item.price * item.qty
    }));

    // แสดงสถานะกำลังส่งข้อมูล (Optional: เปลี่ยนข้อความปุ่ม)
    const btn = document.querySelector('button[onclick="checkoutViaLine()"]');
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> กำลังบันทึกออเดอร์...';

    try {
        // 1. Fetch ไปที่ Cloudflare Pages Function API
        const response = await fetch('/api/submit-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                lineId: lineId,
                customerName: name,
                customerPhone: phone,
                customerAddress: address || '',
                items: itemsData,
                subtotal: sub,
                shippingFee: fee,
                totalAmount: total
            })
        });

        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.error || 'Server error');
        }

        // 2. หากสำเร็จ (Response 200 OK) ให้ทำการเตรียมข้อความ LINE
        const shopName = document.getElementById('header-company-name')?.innerText.trim() || 'ร้านค้าของเรา';
        let txt = `🛒 *คำสั่งซื้อใหม่จากร้าน ${shopName}*\n\n👤 *ชื่อ LINE*: ${lineId}\n👤 *ลูกค้า*: ${name}\n📞 *เบอร์*: ${phone}\n📍 *ที่อยู่*: ${address || '-'}\n\n📦 *สินค้า*\n`;
        cart.forEach((i, idx) => {
            const barcodeTxt = i.barcode ? `\n   📦 บาร์โค้ด: ${i.barcode}` : '';
            txt += `${idx + 1}. *${i.name}*${barcodeTxt}\n   👉 ${i.qty} ${i.unitName} = ฿${(i.price * i.qty).toLocaleString()}\n`;
        });

        txt += `\n🧾 สินค้า: ฿${sub.toLocaleString()}\n🚚 ค่าส่ง: ${fee === 0 ? 'ส่งฟรี' : '฿' + fee.toLocaleString()}\n💰 *รวมสุทธิ: ฿${total.toLocaleString()}*\n\nรบกวนแอดมินสรุปยอดครับ 🙏`;

        // 3. Redirect พาลูกค้าไปที่ LINE OA แชท
        window.location.href = `https://line.me/R/oaMessage/${currentLineId}/?${encodeURIComponent(txt)}`;

    } catch (apiErr) {
        console.error("API Checkout Error:", apiErr);
        alert('เกิดข้อผิดพลาดในการบันทึกออเดอร์: ' + apiErr.message);
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
    }
}

window.addEventListener('scroll', () => {
    const btn = document.getElementById('floating-home-btn');
    if (btn) btn.classList[window.scrollY > 200 ? 'remove' : 'add']('hidden');
});

fetchProductsFromCloud();