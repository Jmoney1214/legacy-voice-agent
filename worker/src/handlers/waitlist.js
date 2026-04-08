// Waitlist handler: add_to_waitlist

export async function handleAddToWaitlist(params, db, log) {
  const product = params.product || params.product_name || null;
  const phone = params.phone_number || params.phone || null;
  const name = params.caller_name || params.name || null;

  if (!product) {
    return Response.json({
      results: [{ result: "What product would you like me to add you to the waitlist for?" }],
    });
  }

  log.info("Adding to waitlist", { product, phone, name });

  const payload = {
    customer_phone: phone,
    customer_name: name,
    product_requested: product,
  };

  const res = await db.insert("restock_interest", payload);
  if (!res.ok) {
    log.error("Waitlist insert failed", { status: res.status });
  }

  return Response.json({
    results: [
      {
        result: `Done — I've added you to the notification list for ${product}. You'll be the first to know when it comes in.`,
      },
    ],
  });
}
