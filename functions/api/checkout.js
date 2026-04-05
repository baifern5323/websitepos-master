import { createClient } from '@supabase/supabase-js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. ตั้งค่า CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // 2. จัดการ OPTIONS request (Pre-flight)
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 3. ดึงข้อมูลจาก Request Body
    const orderData = await request.json();
    const { userId, customerName, customerPhone, customerAddress, items, subtotal, shippingFee, totalAmount, lineId } = orderData;

    // 4. ตรวจสอบ Environment Variables
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration in Environment Variables' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 5. บันทึกข้อมูลลงตาราง orders
    // หมายเหตุ: หากยังไม่มีตารางนี้ คุณต้องสร้างก่อน (ดู SQL ที่ให้ไว้ในภายหลัง)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([
        {
          user_id: userId,
          line_id: lineId,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_address: customerAddress,
          items: items, // เก็บเป็น JSONB
          subtotal: subtotal,
          shipping_fee: shippingFee,
          total_amount: totalAmount,
          status: 'pending',
          created_at: new Date().toISOString(),
        }
      ])
      .select();

    if (orderError) throw orderError;

    // 6. ส่งผลลัพธ์กลับไปยัง Frontend
    return new Response(JSON.stringify({ success: true, orderId: order[0].id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Checkout Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
