require('dotenv').config();
const sql = require('mssql');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. การตั้งค่าระบบ
// ==========================================
const sqlConfig = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DATABASE,
    server: process.env.SQL_SERVER,
    port: process.env.SQL_PORT ? parseInt(process.env.SQL_PORT) : 2301,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: false, trustServerCertificate: true }
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});

const LOCAL_IMAGE_DIR = process.env.LOCAL_IMAGE_DIR;
const PROMO_IMAGE_DIR = path.join(LOCAL_IMAGE_DIR, 'Promotions'); 
const LOGO_IMAGE_DIR = path.join(LOCAL_IMAGE_DIR, 'Logo');

let lastSyncTime = new Date(0);

// ==========================================
// 2. ฟังก์ชันจัดการรูปภาพ
// ==========================================
function getFileModifiedTime(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).mtime;
}

async function processImage(productNumber, localImageName, syncTime) {
    if (!localImageName || String(localImageName).trim() === '') return null;
    let inputPath = String(localImageName).trim();
    if (!path.isAbsolute(inputPath) && LOCAL_IMAGE_DIR) inputPath = path.join(LOCAL_IMAGE_DIR, inputPath);
    const fileMTime = getFileModifiedTime(inputPath);
    if (!fileMTime) return null;

    const webpFileName = `${productNumber}.webp`;
    const publicUrl = `${process.env.R2_PUBLIC_URL}/products/${webpFileName}`;
    if (fileMTime <= syncTime) return publicUrl;

    try {
        const imageBuffer = await sharp(inputPath).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: `products/${webpFileName}`, Body: imageBuffer, ContentType: 'image/webp' }));
        return publicUrl;
    } catch (error) { return null; }
}

// ==========================================
// 🌟 3. ฟังก์ชันสแกนและอัปโหลดรูปโปรโมชั่นสไลด์
// ==========================================
async function syncPromotions() {
    console.log(`\n[Promotion Sync] กำลังตรวจสอบโฟลเดอร์: ${PROMO_IMAGE_DIR}`);
    
    if (!fs.existsSync(PROMO_IMAGE_DIR)) {
        fs.mkdirSync(PROMO_IMAGE_DIR, { recursive: true });
        console.log(`[Promotion Sync] สร้างโฟลเดอร์ Promotions รอไว้แล้วครับ กรุณานำรูปไปใส่`);
        return;
    }

    const files = fs.readdirSync(PROMO_IMAGE_DIR);
    const imageFiles = files.filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
    const supabasePayload = [];

    for (let i = 0; i < imageFiles.length; i++) {
        const fileName = imageFiles[i];
        const inputPath = path.join(PROMO_IMAGE_DIR, fileName);
        const fileMTime = fs.statSync(inputPath).mtime;
        
        const safeName = fileName.replace(/\.[^/.]+$/, "").replace(/\s+/g, '-').toLowerCase();
        const id = `promo_${safeName}`; 
        const webpFileName = `${id}.webp`;
        const publicUrl = `${process.env.R2_PUBLIC_URL}/promotions/${webpFileName}`;

        if (fileMTime > lastSyncTime) {
            try {
                const imageBuffer = await sharp(inputPath)
                    .resize({ width: 1200, withoutEnlargement: true }) 
                    .webp({ quality: 80 })
                    .toBuffer();

                await s3.send(new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: `promotions/${webpFileName}`,
                    Body: imageBuffer,
                    ContentType: 'image/webp'
                }));
                console.log(`[R2] อัปโหลดสไลด์โปรโมชั่นใหม่: ${webpFileName}`);
            } catch (err) {
                console.error(`[R2 Error] อัปโหลดสไลด์ล้มเหลว:`, err.message);
                continue;
            }
        }

        supabasePayload.push({
            id: id,
            image_url: publicUrl,
            is_active: true,
            sort_order: i + 1,
            updated_at: new Date().toISOString()
        });
    }

    if (supabasePayload.length > 0) {
        const currentIds = supabasePayload.map(p => p.id);
        const { data: cloudPromos } = await supabase.from('promotions').select('id');
        if(cloudPromos) {
            const idsToDelete = cloudPromos.map(p => p.id).filter(id => !currentIds.includes(id));
            if(idsToDelete.length > 0) {
                await supabase.from('promotions').delete().in('id', idsToDelete);
                console.log(`[Supabase] เคลียร์โปรโมชั่นเก่า ${idsToDelete.length} รายการ`);
            }
        }

        const { error } = await supabase.from('promotions').upsert(supabasePayload, { onConflict: 'id' });
        if (error) console.error("[Supabase Error] สไลด์โปรโมชั่น:", error);
        else console.log(`[Supabase] อัปเดตโปรโมชั่นสำเร็จ ${supabasePayload.length} รายการ`);
    } else {
        await supabase.from('promotions').delete().neq('id', 'dummy_safeguard'); 
    }
}

// ==========================================
// 🌟 4. ฟังก์ชันดึงข้อมูลบริษัท (Company) + จัดการโฟลเดอร์โลโก้
// ==========================================
async function syncCompany() {
    console.log(`\n[Company Sync] กำลังดึงข้อมูลร้านค้าจากฐานข้อมูล...`);
    let pool;
    try {
        pool = await sql.connect(sqlConfig);
        
        const targetCompanyId = process.env.TARGET_COMPANY_ID || '1';
        
        const res = await pool.request()
            .input('TargetID', sql.VarChar, targetCompanyId)
            .query(`
                SELECT ID, Name, Tel, Address 
                FROM dbo.Company WITH (NOLOCK)
                WHERE ID = @TargetID
            `);
        
        if (res.recordset.length > 0) {
            const c = res.recordset[0];
            
            // 🌟 จัดการสแกนและอัปโหลดโลโก้ร้าน
            let logoUrl = null;
            if (!fs.existsSync(LOGO_IMAGE_DIR)) {
                fs.mkdirSync(LOGO_IMAGE_DIR, { recursive: true });
                console.log(`[Company Sync] สร้างโฟลเดอร์ Logo รอไว้แล้วครับ (ถ้ามีโลโก้ให้นำมาใส่ในโฟลเดอร์นี้)`);
            } else {
                const files = fs.readdirSync(LOGO_IMAGE_DIR);
                const imageFiles = files.filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
                
                // ถ้าระบบเจอไฟล์รูป จะดึงรูปแรกที่เจอมาทำเป็นโลโก้
                if (imageFiles.length > 0) {
                    const logoFile = imageFiles[0]; 
                    const inputPath = path.join(LOGO_IMAGE_DIR, logoFile);
                    const fileMTime = fs.statSync(inputPath).mtime;
                    
                    const webpFileName = `logo_${targetCompanyId}.webp`;
                    const publicUrl = `${process.env.R2_PUBLIC_URL}/logo/${webpFileName}`;
                    
                    // อัปโหลดขึ้น R2 ถ้าเป็นไฟล์ใหม่หรือเพิ่งแก้ไข
                    if (fileMTime > lastSyncTime) {
                        try {
                            const imageBuffer = await sharp(inputPath)
                                .resize({ height: 120, withoutEnlargement: true }) // ย่อโลโก้ให้พอดี ไม่ให้หนักเว็บ
                                .webp({ quality: 90 })
                                .toBuffer();

                            await s3.send(new PutObjectCommand({
                                Bucket: process.env.R2_BUCKET_NAME,
                                Key: `logo/${webpFileName}`,
                                Body: imageBuffer,
                                ContentType: 'image/webp'
                            }));
                            console.log(`[R2] อัปโหลดโลโก้ร้านใหม่: ${webpFileName}`);
                        } catch (err) {
                            console.error(`[R2 Error] อัปโหลดโลโก้ล้มเหลว:`, err.message);
                        }
                    }
                    logoUrl = publicUrl;
                }
            }

            const payload = {
                id: String(c.ID).trim(),
                name: String(c.Name).trim(),
                phone: c.Tel ? String(c.Tel).trim() : '',
                address: c.Address ? String(c.Address).trim() : '',
                logo_url: logoUrl, // ส่ง URL โลโก้ไปเก็บใน Supabase ด้วย
                updated_at: new Date().toISOString()
            };
            
            const { error } = await supabase.from('company_profile').upsert(payload, { onConflict: 'id' });
            if (error) throw error;
            console.log(`[Supabase] อัปเดตข้อมูลบริษัทสำเร็จ (มีรูปโลโก้: ${logoUrl ? 'ใช่' : 'ไม่ใช่'})`);
        } else {
            console.log(`[Company Sync] ⚠️ ไม่พบข้อมูลบริษัท ID: ${targetCompanyId} ในฐานข้อมูล`);
        }
    } catch (err) {
        console.error('[Sync Error Company]:', err);
    } finally {
        if (pool) pool.close();
    }
}

// ==========================================
// 5. ฟังก์ชัน Sync ข้อมูลหลัก (แยกรายตาราง)
// ==========================================
async function syncData() {
    const currentSyncStart = new Date();
    console.log(`\n[${currentSyncStart.toLocaleString()}] 🔄 เริ่มกระบวนการ Sync ข้อมูลทั้งหมด...`);

    let pool;
    try {
        pool = await sql.connect(sqlConfig);

        // ---------------------------------------------------------
        // 📌 STEP 1: ตารางกลุ่มสินค้า (product_groups)
        // ---------------------------------------------------------
        const groupRes = await pool.request().query(`SELECT ID, Name FROM dbo.ProductGroup WITH (NOLOCK)`);
        if (groupRes.recordset.length > 0) {
            const groups = groupRes.recordset.map(g => ({ 
                id: String(g.ID).trim(), 
                name: String(g.Name).trim() 
            }));
            await supabase.from('product_groups').upsert(groups, { onConflict: 'id' });
            console.log(`[1/4] ✔️ Sync กลุ่มสินค้าสำเร็จ (${groups.length} รายการ)`);
        }

        // ---------------------------------------------------------
        // 📌 STEP 2: ตารางยี่ห้อ (brands)
        // ---------------------------------------------------------
        const brandRes = await pool.request().query(`SELECT ID, Name FROM dbo.Brand WITH (NOLOCK)`);
        if (brandRes.recordset.length > 0) {
            const brands = brandRes.recordset.map(b => ({ 
                id: String(b.ID).trim(), 
                name: String(b.Name).trim() 
            }));
            await supabase.from('brands').upsert(brands, { onConflict: 'id' });
            console.log(`[2/4] ✔️ Sync ยี่ห้อสำเร็จ (${brands.length} รายการ)`);
        }

        // ---------------------------------------------------------
        // 📌 STEP 3.1: ตารางสินค้าหลัก (Products)
        // ---------------------------------------------------------
        const targetBranchNumber = process.env.TARGET_BRANCH_NUMBER || '1';
        const products = [];
        const activePNs = new Set();

        const productRes = await pool.request()
            .input('TargetBranch', sql.VarChar, targetBranchNumber)
            .query(`
            SELECT 
                p.PN, p.ProductCode, p.Barcode, p.Name, p.Name2, 
                p.Price1, p.Price2, p.Price3, p.Price4, p.Price5, 
                p.SUnit, ISNULL(s.Number, 0) as StockQty, 
                p.PicName, p.PicSmall, p.WebDetail, 
                p.HotProduct, p.ShowOnWeb, p.WebShowSUnit, p.WebShowLUnit,
                p.GroupID, p.BrandID, p.Status
            FROM dbo.Product p WITH (NOLOCK)
            LEFT JOIN dbo.Stock s WITH (NOLOCK) ON p.PN = s.PN AND s.BranchNumber = @TargetBranch
        `);
        
        for (const p of productRes.recordset) {
            const pn = String(p.PN).trim();
            if(activePNs.has(pn)) continue;
            activePNs.add(pn);

            let imageUrl = await processImage(pn, p.PicSmall, lastSyncTime);
            
            products.push({
                pn: pn,
                product_code: p.ProductCode ? String(p.ProductCode).trim() : null,
                barcode: p.Barcode ? String(p.Barcode).trim() : null,
                name: p.Name ? String(p.Name).trim() : 'Unnamed',
                name2: p.Name2 ? String(p.Name2).trim() : null,
                price1: p.Price1 || 0,
                price2: p.Price2 || 0,
                price3: p.Price3 || 0,
                price4: p.Price4 || 0,
                price5: p.Price5 || 0,
                s_unit: p.SUnit ? String(p.SUnit).trim() : 'ชิ้น',
                stock: p.StockQty,
                pic_name: p.PicName ? String(p.PicName).trim() : null,
                pic_small: p.PicSmall ? String(p.PicSmall).trim() : null,
                image_url: imageUrl,
                web_detail: p.WebDetail ? String(p.WebDetail).trim() : null,
                is_hot: p.HotProduct === 1,
                show_on_web: p.ShowOnWeb === 1,
                web_show_s_unit: p.WebShowSUnit === 1,
                web_show_l_unit: p.WebShowLUnit === 1,
                status: p.Status === 1 ? 1 : 0, 
                group_id: p.GroupID ? String(p.GroupID).trim() : null,
                brand_id: p.BrandID ? String(p.BrandID).trim() : null,
                updated_at: new Date().toISOString()
            });
        }
        
        if (products.length > 0) {
            const chunkSize = 200;
            for (let i = 0; i < products.length; i += chunkSize) {
                const chunk = products.slice(i, i + chunkSize);
                const { error } = await supabase.from('products').upsert(chunk, { onConflict: 'pn' });
                if (error) console.error("[Supabase Error Products]:", error);
            }
            console.log(`[3.1/4] ✔️ Sync สินค้าหลักสำเร็จ (${products.length} รายการ)`);
        }

        // ระบบลบข้อมูลขยะ (Products)
        const { data: cloudProducts } = await supabase.from('products').select('pn');
        if (cloudProducts) {
            const idsToDelete = cloudProducts.map(p => String(p.pn).trim()).filter(pn => !activePNs.has(pn));
            if (idsToDelete.length > 0) {
                for (let i = 0; i < idsToDelete.length; i += 100) {
                    await supabase.from('products').delete().in('pn', idsToDelete.slice(i, i + 100));
                }
                console.log(`[Cleanup] 🗑️ ลบข้อมูลขยะออกจากตารางสินค้า: ${idsToDelete.length} รายการ`);
            }
        }

        // ---------------------------------------------------------
        // 📌 STEP 3.2: ตารางสินค้าชุด (ProductSet)
        // ---------------------------------------------------------
        const productSetRes = await pool.request().query(`
            SELECT 
                ps.PSN, ps.Barcode, ps.Name, 
                ps.Price1, ps.Price2, ps.Price3, ps.Price4, ps.Price5, 
                ps.Unit, ps.GroupID, ps.HotProduct, ps.PicName, ps.Status
            FROM dbo.ProductSet ps WITH (NOLOCK)
            WHERE ps.Status IS NULL OR ps.Status = 0
        `);

        const productSets = [];
        const activePSNs = new Set();

        for (const ps of productSetRes.recordset) {
            const psn = String(ps.PSN).trim();
            if(activePSNs.has(psn)) continue;
            activePSNs.add(psn);

            let imageUrl = await processImage(`SET_${psn}`, ps.PicName, lastSyncTime);
            
            productSets.push({
                psn: psn,
                barcode: ps.Barcode ? String(ps.Barcode).trim() : null,
                name: ps.Name ? String(ps.Name).trim() : 'Unnamed Set',
                price1: ps.Price1 || 0,
                price2: ps.Price2 || 0,
                price3: ps.Price3 || 0,
                price4: ps.Price4 || 0,
                price5: ps.Price5 || 0,
                unit: ps.Unit ? String(ps.Unit).trim() : 'ชุด',
                group_id: ps.GroupID ? String(ps.GroupID).trim() : null,
                is_hot: ps.HotProduct === 1,
                image_url: imageUrl,
                status: ps.Status === 1 ? 1 : 0, 
                updated_at: new Date().toISOString()
            });
        }
        
        if (productSets.length > 0) {
            const chunkSize = 200;
            for (let i = 0; i < productSets.length; i += chunkSize) {
                const chunk = productSets.slice(i, i + chunkSize);
                const { error } = await supabase.from('product_sets').upsert(chunk, { onConflict: 'psn' });
                if (error) console.error("[Supabase Error ProductSets]:", error);
            }
            console.log(`[3.2/4] ✔️ Sync สินค้าจัดชุดสำเร็จ (${productSets.length} รายการ)`);
        }

        // ระบบลบข้อมูลขยะ (ProductSets)
        const { data: cloudProductSets } = await supabase.from('product_sets').select('psn');
        if (cloudProductSets) {
            const idsToDelete = cloudProductSets.map(p => String(p.psn).trim()).filter(psn => !activePSNs.has(psn));
            if (idsToDelete.length > 0) {
                for (let i = 0; i < idsToDelete.length; i += 100) {
                    await supabase.from('product_sets').delete().in('psn', idsToDelete.slice(i, i + 100));
                }
                console.log(`[Cleanup] 🗑️ ลบข้อมูลขยะออกจากตารางสินค้าชุด: ${idsToDelete.length} รายการ`);
            }
        }

        // ---------------------------------------------------------
        // 📌 STEP 4: ตารางหน่วยและราคาส่ง (product_units)
        // ---------------------------------------------------------
        const unitRes = await pool.request().query(`
            SELECT 
                pu.PN, pu.LUnit, pu.MUnit, 
                pu.NumMPerLUnit, pu.NumSPerLUnit, pu.Barcode, 
                pu.Price1, pu.Price2, pu.Price3
            FROM dbo.ProductUnit pu WITH (NOLOCK)
        `);

        const units = unitRes.recordset.map(u => {
            const pnStr = String(u.PN).trim();
            const lUnitStr = u.LUnit ? String(u.LUnit).trim() : null;
            const mUnitStr = u.MUnit ? String(u.MUnit).trim() : null;
            const unitName = lUnitStr || mUnitStr || 'UNIT';
            const generatedId = `${pnStr}_${unitName}`;

            return {
                id: generatedId,
                pn: pnStr,
                l_unit: lUnitStr,
                m_unit: mUnitStr,
                num_m_per_l_unit: u.NumMPerLUnit || 0,
                num_s_per_l_unit: u.NumSPerLUnit || 0,
                barcode: u.Barcode ? String(u.Barcode).trim() : null,
                price1: u.Price1 || 0,
                price2: u.Price2 || 0,
                price3: u.Price3 || 0
            };
        });

        if (units.length > 0) {
            const chunkSize = 200;
            for (let i = 0; i < units.length; i += chunkSize) {
                const chunk = units.slice(i, i + chunkSize);
                const { error } = await supabase.from('product_units').upsert(chunk, { onConflict: 'id' });
                if (error) console.error("[Supabase Error Units]:", error);
            }
            console.log(`[4/4] ✔️ Sync ข้อมูลหน่วยและราคาส่งสำเร็จ (${units.length} รายการ)`);
        }

        // 🌟 รันฟังก์ชัน Sync ภาพโปรโมชั่น
        await syncPromotions();
        
        // 🌟 รันฟังก์ชัน Sync ข้อมูลบริษัท
        await syncCompany();

        lastSyncTime = currentSyncStart;
        console.log('✅ Sync เสร็จสมบูรณ์เรียบร้อยครับ!');

    } catch (err) {
        console.error('❌ [Sync Error]:', err);
    } finally {
        if (pool) pool.close();
    }
}

console.log('==============================================');
console.log('🚀 CC EasyWeb - POS Sync V4 (Products & ProductSets separated)');
console.log('==============================================');

syncData(); 
cron.schedule('*/5 * * * *', () => syncData());