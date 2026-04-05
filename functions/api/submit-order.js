import { createClient } from '@supabase/supabase-js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Setup CORS headings
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // 2. Handle OPTIONS request (Pre-flight)
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 3. Extract Order Data from Body
    const orderData = await request.json();
    const { 
      userId, 
      lineId, 
      customerName, 
      customerPhone, 
      customerAddress, 
      items, 
      subtotal, 
      shippingFee, 
      totalAmount 
    } = orderData;

    // 4. Check Environment Variables
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing Supabase configuration. Please check Cloudflare Environment Variables.' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 5. Insert data into 'orders' table
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([
        {
          user_id: userId,          // LINE User ID from profiling
          line_id: lineId,          // Customer's LINE Display Name
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_address: customerAddress,
          items: items,             // Store items as JSONB
          subtotal: subtotal,
          shipping_fee: shippingFee,
          total_amount: totalAmount,
          status: 'pending',
          created_at: new Date().toISOString(),
        }
      ])
      .select();

    if (orderError) {
      console.error('Supabase Error:', orderError);
      throw orderError;
    }

    // 6. Return Success Response
    return new Response(JSON.stringify({ 
      success: true, 
      orderId: order[0].id 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
