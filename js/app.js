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
let promotions = []; 
let activeCategory = 'All';
let searchQuery = '';
let selectedUnits = {}; 

// 🌟 ตัวแปรสำหรับระบบแบ่งหน้า (Pagination)
let currentPage = 1;
const itemsPerPage = 20; // 5 แถว * 4 ชิ้นต่อแถว (บนจอคอม) = 20 ชิ้นต่อหน้า

let currentPromoSlide = 0;
let promoSlideInterval;

// ==========================================
// 🌟 3. ฟังก์ชันควบคุมเมนูแฮมเบอร์เกอร์
// ==========================================
window.toggleCategories = function() {
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
        
        let combinedProducts = [];

        // 🌟 4.1 ดึงข้อมูลสินค้าปกติ (Products)
        const { data: productData, error: productError } = await supabaseClient
            .from('products')
            .select(`
                *,
                product_groups (name),
                product_units (*)
            `);

        if (!productError && productData && productData.length > 0) {
            const activeData = productData.filter(p => p.status !== 1 && p.show_on_web === true);

            const standardProducts = activeData.map(p => {
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
            });
            combinedProducts = [...combinedProducts, ...standardProducts];
        }

        // 🌟 4.2 ดึงข้อมูลสินค้าชุด (ProductSets)
        const { data: setData, error: setError } = await supabaseClient
            .from('product_sets')
            .select('*');

        if (!setError && setData && setData.length > 0) {
            const activeSets = setData.filter(p => p.status !== 1 && p.is_hot === true);
            
            const setProducts = activeSets.map(p => {
                return {
                    id: `SET_${p.psn}`,
                    barcode: p.barcode,
                    name: p.name,
                    price: p.price1,
                    stock: 999,
                    image_url: p.image_url,
                    web_detail: 'สินค้าจัดเซ็ตสุดคุ้ม', 
                    category: 'สินค้าจัดเซ็ต', 
                    is_hot: p.is_hot, 
                    units: [{ name: p.unit ? p.unit.trim() : 'ชุด', price: p.price1 }]
                };
            });
            combinedProducts = [...combinedProducts, ...setProducts];
        }

        if (combinedProducts.length > 0) {
            products = combinedProducts
                .filter(p => p.units.length > 0)
                .sort((a, b) => a.name.localeCompare(b.name, 'th'));
        }

        const { data: promoData, error: promoError } = await supabaseClient
            .from('promotions')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
            
        if (!promoError && promoData) {
            promotions = promoData;
        }

        // 🌟 4.4 ดึงข้อมูลบริษัทและจัดการโลโก้ (แก้ปัญหาดึงข้อมูลผิดแถว)
        const { data: companyData, error: companyError } = await supabaseClient
            .from('company_profile')
            .select('*')
            .order('updated_at', { ascending: false }) // 🌟 บังคับดึงแถวที่อัปเดตล่าสุดเสมอ ป้องกันการดึงแถวว่าง
            .limit(1);
            
        if (!companyError && companyData && companyData.length > 0) {
            const company = companyData[0];
            
            const headerName = document.getElementById('header-company-name');
            const footerName = document.getElementById('footer-company-name');
            if (headerName) headerName.innerText = company.name || 'SabuyShop';
            if (footerName) footerName.innerText = company.name || 'SabuyShop';
            
            const headerPhone = document.getElementById('header-company-phone');
            const footerPhone = document.getElementById('footer-company-phone');
            if (headerPhone && company.phone) headerPhone.innerText = company.phone;
            if (footerPhone && company.phone) footerPhone.innerText = company.phone;

            const footerAddress = document.getElementById('footer-company-address');
            if (footerAddress && company.address && company.address.trim() !== '') {
                footerAddress.innerText = company.address;
                footerAddress.classList.remove('hidden'); 
            }
            
            // 🌟 บังคับแสดงโลโก้ ถ้าระบบพบ URL ในฐานข้อมูล
            const headerLogo = document.getElementById('header-company-logo');
            if (headerLogo) {
                if (company.logo_url && company.logo_url.trim() !== '') {
                    headerLogo.src = company.logo_url;
                    headerLogo.classList.remove('hidden'); 
                    headerLogo.style.display = 'block'; // สั่งบังคับโชว์
                } else {
                    headerLogo.classList.add('hidden');
                    headerLogo.style.display = 'none'; // ซ่อนเฉพาะตอนไม่มี URL จริงๆ
                }
            }
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
    categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
    document.getElementById('loading-spinner').style.display = 'none';
    
    // 🌟 คืนค่าโครงสร้างสินค้าทั้งหมดให้เป็นแบบ Grid (เรียง 4 แถวปกติ ไม่ต้องเลื่อนแนวนอน)
    const catGrid = document.getElementById('category-products-grid');
    if (catGrid) {
        catGrid.className = 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6';
        catGrid.style.scrollSnapType = '';
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

    // 🌟 เลื่อนเมาส์ได้เฉพาะ "สินค้าขายดี" และ "แท็บหมวดหมู่" เท่านั้น
    enableMouseDrag('hot-products-grid');
    enableMouseDrag('tab-categories');
}

// 🌟 ฟังก์ชันเสริม: เลื่อนซ้ายขวาด้วยเมาส์ (รองรับทั้งคลิกซ้าย, กดลูกกลิ้ง และหมุนลูกกลิ้ง)
function enableMouseDrag(elementId) {
    const slider = document.getElementById(elementId);
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        // รองรับทั้งคลิกซ้าย (0) และกดลูกกลิ้งเมาส์ (1)
        if (e.button !== 0 && e.button !== 1) return;
        if (e.button === 1) e.preventDefault(); // ป้องกันหน้าต่าง Auto-scroll ของเบราว์เซอร์

        isDown = true;
        slider.style.cursor = 'grabbing';
        slider.style.scrollSnapType = 'none'; 
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });

    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.style.cursor = 'grab';
        slider.style.scrollSnapType = 'x mandatory';
    });

    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.style.cursor = 'grab';
        slider.style.scrollSnapType = 'x mandatory';
    });

    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault(); // ป้องกันเมาส์ไปคลุมดำ (Highlight) ตัวหนังสือตอนลาก
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5; 
        slider.scrollLeft = scrollLeft - walk;
    });

    // 🌟 เพิ่มฟังก์ชันโบนัส: "หมุน" ลูกกลิ้งเมาส์เพื่อเลื่อนซ้ายขวาได้เลย
    slider.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault(); // ป้องกันหน้าเว็บเลื่อนขึ้นลงตอนหมุนลูกกลิ้งในกรอบนี้
            slider.style.scrollSnapType = 'none';
            // ปรับความเร็วในการเลื่อนตอนหมุนลูกกลิ้ง (เลข 100)
            slider.scrollLeft += e.deltaY > 0 ? 100 : -100; 
            
            clearTimeout(slider.wheelTimeout);
            slider.wheelTimeout = setTimeout(() => {
                slider.style.scrollSnapType = 'x mandatory';
            }, 150);
        }
    }, { passive: false });

    slider.style.cursor = 'grab';
}

function renderPromotions() {
    const slider = document.getElementById('promo-slider');
    const dotsContainer = document.getElementById('promo-dots');
    if (!slider || !dotsContainer) return;

    if (promotions.length === 0) {
        slider.innerHTML = `
            <div class="min-w-full h-full flex items-center justify-center bg-[#f5f5f5] cursor-pointer" onclick="document.getElementById('shop-section').scrollIntoView({behavior: 'smooth'});">
                <img src="image_a3b10d.jpg" alt="Promotion Banner" class="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.02]" onerror="this.src='https://placehold.co/1200x400/f5f5f5/94a3b8?text=SabuyShop+Promotion'" />
            </div>`;
        dotsContainer.innerHTML = '';
        return;
    }

    slider.innerHTML = promotions.map(promo => `
        <div class="min-w-full h-full relative bg-gray-100 flex items-center justify-center cursor-pointer" onclick="document.getElementById('shop-section').scrollIntoView({behavior: 'smooth'});">
            <img src="${promo.image_url}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.02]" alt="Promotion Banner" />
        </div>
    `).join('');

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
    promoSlideInterval = setInterval(window.nextPromoSlide, 4000); 
}

function resetPromoTimer() {
    startPromoTimer();
}

// 🌟 ปรับแต่ง Sidebar ให้ตัวหนังสือใหญ่ขึ้น (text-base) และเพิ่มความห่างบรรทัด (py-3)
function renderSidebar() {
    const ul = document.getElementById('sidebar-categories');
    
    // ปุ่มหมวดหมู่ 'ทั้งหมด'
    let html = `<li><button onclick="setActiveCategory('All')" class="w-full text-left px-6 py-3 hover:text-[#7fad39] transition text-base ${activeCategory === 'All' ? 'text-[#7fad39] font-bold bg-green-50 border-l-4 border-[#7fad39]' : 'text-gray-600 border-l-4 border-transparent'}">สินค้าทั้งหมด</button></li>`;
    
    categories.forEach(cat => {
        const isSpecial = cat === 'สินค้าจัดเซ็ต';
        let textClass = '';
        
        if (activeCategory === cat) {
            textClass = isSpecial 
                ? 'text-orange-600 font-extrabold bg-orange-50 border-l-4 border-orange-500' 
                : 'text-[#7fad39] font-bold bg-green-50 border-l-4 border-[#7fad39]';
        } else {
            textClass = isSpecial 
                ? 'text-orange-500 font-bold hover:bg-orange-50 hover:text-orange-600 border-l-4 border-transparent' 
                : 'text-gray-600 hover:text-[#7fad39] hover:bg-gray-50 border-l-4 border-transparent';
        }
        
        const icon = isSpecial ? '<i class="fa-solid fa-gift mr-2 animate-pulse text-lg"></i>' : '';
        // เพิ่ม text-base และ py-3 เพื่อให้ฟอนต์ใหญ่และอ่านง่าย
        html += `<li><button onclick="setActiveCategory('${cat}')" class="w-full text-left px-6 py-3 transition text-base ${textClass}">${icon}${cat}</button></li>`;
    });
    ul.innerHTML = html;
}

// 🌟 ปรับแต่ง Tabs แคปซูล
function renderTabs() {
    const container = document.getElementById('tab-categories');
    if (!container) return;
    
    let html = `<button onclick="setActiveCategory('All')" class="whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all duration-300 shadow-sm flex-shrink-0 ${activeCategory === 'All' ? 'bg-[#7fad39] text-white border-[#7fad39]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#7fad39] hover:text-[#7fad39]'}">ทั้งหมด</button>`;
    
    categories.forEach(cat => {
        const isSpecial = cat === 'สินค้าจัดเซ็ต';
        let btnClass = '';
        
        if (activeCategory === cat) {
            btnClass = isSpecial 
                ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white border-transparent shadow-md' 
                : 'bg-[#7fad39] text-white border-[#7fad39]';
        } else {
            btnClass = isSpecial 
                ? 'bg-orange-50 text-orange-600 border-orange-300 hover:border-orange-500 hover:bg-orange-500 hover:text-white' 
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#7fad39] hover:text-[#7fad39]';
        }
        
        const icon = isSpecial ? '<i class="fa-solid fa-gift mr-1"></i> ' : '';
        html += `<button onclick="setActiveCategory('${cat}')" class="whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all duration-300 shadow-sm flex-shrink-0 ${btnClass}">${icon}${cat}</button>`;
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

    // 🌟 ดักเช็คถ้าเป็นสินค้าจัดเซ็ต ให้เปลี่ยน Detail ธรรมดา เป็นป้าย Badge สีส้มสุดพรีเมียม
    const renderWebDetail = () => {
        if (product.category === 'สินค้าจัดเซ็ต') {
            return `<div class="h-7 md:h-8 mb-2 w-full text-left">
                        <span class="inline-flex items-center gap-1 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] md:text-xs font-bold px-2.5 py-0.5 rounded-md shadow-sm">
                            <i class="fa-solid fa-gift"></i> ${product.web_detail || 'เซ็ตสุดคุ้ม'}
                        </span>
                    </div>`;
        } else if (product.web_detail) {
            return `<p class="text-[10px] md:text-xs text-gray-500 line-clamp-2 mb-2 leading-snug text-left w-full h-7 md:h-8" title="${product.web_detail}">${product.web_detail}</p>`;
        } else {
            return `<div class="h-7 md:h-8 mb-2 w-full"></div>`;
        }
    };

    // 🌟 ปรับแต่งคลาสของกรอบการ์ดให้โดดเด่นถ้าเป็นสินค้า Hot Product
    const cardStyle = product.is_hot 
        ? 'border-2 border-red-400 shadow-md shadow-red-100 hover:shadow-lg hover:shadow-red-200 hover:border-red-500 bg-gradient-to-b from-red-50/30 to-white' 
        : 'border border-gray-100 hover:border-[#7fad39]/30 shadow-sm hover:shadow-md bg-white';

    // 🌟 ปรับสีราคาและปุ่มตะกร้าให้เข้ากับธีม Hot Product
    const priceColor = product.is_hot ? 'text-red-600' : 'text-black';
    const btnColor = product.is_hot ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600' : 'bg-[#7fad39] hover:bg-[#6c9331]';

    return `
    <div class="group flex flex-col items-center relative pb-3 md:pb-4 rounded-xl transition-all overflow-hidden w-full h-full ${cardStyle}">
        <div class="w-full aspect-[4/3] bg-[#f5f5f5] relative overflow-hidden mb-2 md:mb-4">
            <img src="${product.image_url}" onerror="this.src='https://placehold.co/400x300/f8fafc/94a3b8?text=No+Image'" class="w-full h-full object-cover transition duration-500 group-hover:scale-105 ${isOutOfStock ? 'opacity-50 grayscale' : ''}" />
            ${!isOutOfStock && product.is_hot ? '<div class="absolute top-2 right-2 md:top-3 md:right-3 bg-gradient-to-r from-red-500 to-rose-500 text-white text-[10px] md:text-xs font-black px-3 py-1 rounded-full shadow-lg shadow-red-500/40 z-10 animate-pulse border border-white/30"><i class="fa-solid fa-fire mr-1"></i>HOT</div>' : ''}
            ${isOutOfStock ? '<div class="absolute top-2 left-2 md:top-3 md:left-3 bg-gray-800 text-white text-[10px] md:text-xs font-bold px-3 py-1 rounded-sm z-10 shadow-md">SOLD OUT</div>' : ''}
        </div>
        <div class="text-center w-full px-2 md:px-4 flex flex-col flex-1">
            <h6 class="text-gray-400 text-[10px] md:text-xs mb-1 font-mono">${displayCode}</h6>
            <a href="#" class="text-sm md:text-lg text-black font-medium hover:text-[#7fad39] transition line-clamp-2 mb-1 h-10 md:h-14 leading-tight">${product.name}</a>
            
            ${renderWebDetail()}

            <div class="mt-auto mb-2 md:mb-3">${unitSelectHtml}</div>
            <div class="flex justify-between items-center w-full mt-1">
                <h5 class="text-base md:text-xl font-bold ${priceColor} text-left">฿${Number(currentUnit.price).toLocaleString()}</h5>
                <button onclick="addToCart('${product.id}')" ${isOutOfStock ? 'disabled' : ''} class="w-8 h-8 md:w-10 md:h-10 ${btnColor} rounded-full flex items-center justify-center text-white disabled:bg-gray-300 disabled:from-gray-300 disabled:to-gray-300 transition-all shadow-sm shrink-0 hover:scale-105">
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
        // 🌟 แก้ไข: ยกเลิกการจำกัดจำนวน ให้แสดงสินค้าขายดีทั้งหมดเวลาเลื่อน
        hotGrid.innerHTML = filteredHot.map(p => `
            <div class="w-[160px] md:w-[240px] shrink-0 snap-start flex">
                ${createProductCard(p)}
            </div>
        `).join('');
    } else { hotSection.classList.add('hidden'); }

    const catGrid = document.getElementById('category-products-grid');
    const emptyState = document.getElementById('empty-state');
    const paginationContainer = document.getElementById('pagination-controls'); 

    const filteredCat = products.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchQuery) || 
                            p.id.toLowerCase().includes(searchQuery) ||
                            (p.barcode && p.barcode.toLowerCase().includes(searchQuery));
        const matchCat = activeCategory === 'All' || p.category === activeCategory;
        return matchSearch && matchCat;
    });

    if (filteredCat.length > 0) {
        emptyState.classList.add('hidden');
        catGrid.classList.remove('hidden'); 
        
        const totalPages = Math.ceil(filteredCat.length / itemsPerPage);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const paginatedCat = filteredCat.slice(startIndex, startIndex + itemsPerPage);
        
        // 🌟 กลับมาวาดการ์ดสินค้าแบบเต็มพื้นที่ตารางปกติ
        catGrid.innerHTML = paginatedCat.map(p => createProductCard(p)).join('');
        
        renderPagination(totalPages);
    } else {
        catGrid.innerHTML = ''; 
        catGrid.classList.add('hidden'); 
        emptyState.classList.remove('hidden');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            paginationContainer.classList.add('hidden');
        }
    }
}

function renderPagination(totalPages) {
    const paginationContainer = document.getElementById('pagination-controls');
    if (!paginationContainer) return;

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        paginationContainer.classList.add('hidden');
        return;
    }

    paginationContainer.classList.remove('hidden');
    let html = '';

    const prevDisabled = currentPage === 1 ? 'disabled' : '';
    const prevClass = currentPage === 1 ? 'opacity-50 cursor-not-allowed bg-gray-50 text-gray-400' : 'hover:bg-[#7fad39] hover:text-white text-gray-600 bg-white cursor-pointer';
    html += `<button onclick="if(typeof changePage === 'function') changePage(${currentPage - 1})" ${prevDisabled} class="w-10 h-10 rounded-full flex items-center justify-center border border-gray-200 transition-colors shadow-sm ${prevClass}"><i class="fa-solid fa-chevron-left"></i></button>`;

    let startP = Math.max(1, currentPage - 2);
    let endP = Math.min(totalPages, startP + 4);
    if (endP - startP < 4) {
        startP = Math.max(1, endP - 4);
    }

    for (let i = startP; i <= endP; i++) {
        if (i === currentPage) {
            html += `<button class="w-10 h-10 rounded-full flex items-center justify-center bg-[#7fad39] text-white font-bold shadow-md border border-[#7fad39]">${i}</button>`;
        } else {
            html += `<button onclick="if(typeof changePage === 'function') changePage(${i})" class="w-10 h-10 rounded-full flex items-center justify-center border border-gray-200 text-gray-600 hover:bg-[#7fad39] hover:text-white transition-colors shadow-sm bg-white">${i}</button>`;
        }
    }

    const nextDisabled = currentPage === totalPages ? 'disabled' : '';
    const nextClass = currentPage === totalPages ? 'opacity-50 cursor-not-allowed bg-gray-50 text-gray-400' : 'hover:bg-[#7fad39] hover:text-white text-gray-600 bg-white cursor-pointer';
    html += `<button onclick="if(typeof changePage === 'function') changePage(${currentPage + 1})" ${nextDisabled} class="w-10 h-10 rounded-full flex items-center justify-center border border-gray-200 transition-colors shadow-sm ${nextClass}"><i class="fa-solid fa-chevron-right"></i></button>`;

    paginationContainer.innerHTML = html;
}

window.changePage = function(page) {
    currentPage = page;
    renderProducts();
    
    const targetTitle = document.getElementById('category-title');
    if (targetTitle) {
        const yOffset = -140; 
        const y = targetTitle.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({top: y, behavior: 'smooth'});
    }
}

// ==========================================
// 6. ระบบตะกร้า (Cart) และค้นหา (Search)
// ==========================================
window.handleSearch = function(val) { 
    searchQuery = val.toLowerCase(); 
    currentPage = 1; 
    renderProducts(); 
}

window.setActiveCategory = function(cat) {
    activeCategory = cat; 
    currentPage = 1; 
    document.getElementById('category-title').innerText = cat === 'All' ? 'สินค้าทั้งหมด' : cat;
    renderSidebar(); renderTabs(); renderProducts();
    
    if (window.innerWidth < 1024) {
        const menu = document.getElementById('sidebar-categories');
        const chevron = document.getElementById('category-chevron');
        if (menu && chevron) {
            menu.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    const targetTitle = document.getElementById('category-title');
    if (targetTitle) {
        const yOffset = -140; 
        const y = targetTitle.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({top: y, behavior: 'smooth'});
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
    let orderText = `🛒 *สั่งซื้อสินค้าจากเว็บ*\\n\\n`;
    cart.forEach((item, index) => { 
        const codeLine = item.barcode ? `บาร์โค้ด: ${item.barcode}` : `รหัส: ${item.id}`;
        orderText += `${index + 1}. ${item.name}\\n   ${codeLine}\\n   จำนวน: ${item.qty} ${item.unitName} (฿${(item.price * item.qty).toLocaleString()})\\n\\n`; 
    });
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    orderText += `💰 *ยอดรวมทั้งสิ้น: ฿${totalAmount.toLocaleString()}*\\n\\nรบกวนแอดมินสรุปยอดให้ด้วยครับ/ค่ะ`;
    const encodedText = encodeURIComponent(orderText);
    window.open(`https://line.me/R/oaMessage/${LINE_OA_ID}/?${encodedText}`, '_blank');
}

// ==========================================
// 🌟 8. ระบบปุ่มลอย (Floating Buttons)
// ==========================================
window.clearSearchAndGoHome = function() {
    // ล้างข้อความในช่องค้นหาทุกช่องบนหน้าเว็บ
    const searchInputs = document.querySelectorAll('input[placeholder*="ค้นหา"]');
    searchInputs.forEach(input => input.value = '');
    
    // รีเซ็ตการค้นหา และกลับไปหมวดหมู่ทั้งหมด
    searchQuery = '';
    setActiveCategory('All');
    
    // เลื่อนหน้าจอกลับไปบนสุด
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

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

    // 🌟 ซ่อนเมนูมือถือเวลาเลื่อนหน้าจอลง และแสดงเมื่ออยู่บนสุด
    const mobileNav = document.getElementById('mobile-nav-menu');
    if (mobileNav) {
        if (window.scrollY > 50) {
            mobileNav.style.display = 'none'; // ซ่อนเมนูตอนเลื่อนลง
        } else {
            mobileNav.style.display = ''; // 🌟 แก้ไข: ล้างค่า display ทิ้ง เพื่อไม่ให้มันไปบังคับโชว์บนจอคอมพิวเตอร์
        }
    }
});

// 🌟 9. ดักจับการย่อ-ขยายหน้าจอ (Resize Event) 
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024 && lastWidth < 1024) {
        const menu = document.getElementById('sidebar-categories');
        const chevron = document.getElementById('category-chevron');
        if (menu && chevron) {
            menu.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
        }
    } 
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
