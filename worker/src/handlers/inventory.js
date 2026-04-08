// Inventory handlers: check_inventory + suggest_alternatives

export async function handleCheckInventory(params, db, log) {
  const product = params.product_name || params.product || "";
  if (!product) {
    return result("What product are you looking for? I can check our inventory.");
  }

  const searchTerm = product.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const keywords = searchTerm.split(/\s+/).filter((w) => w.length > 1);
  const searchQuery = keywords.join(" ");

  log.info("Inventory search", { product, searchQuery });

  // Primary: Supabase RPC with fuzzy matching
  let items;
  const rpcRes = await db.rpc("search_inventory", { search_query: searchQuery });
  if (rpcRes.ok) {
    items = await rpcRes.json();
  }

  // Fallback: ILIKE with keyword stemming
  if (!items || items.length === 0) {
    let path = `inventory?select=description,price,qoh,in_stock,category&price=gt.0&order=in_stock.desc,qoh.desc.nullslast&limit=5`;
    for (const kw of keywords) {
      const root = kw.replace(/s$/i, "");
      path += `&description=ilike.*${encodeURIComponent(root)}*`;
    }

    const fallbackRes = await db.query(path);
    if (fallbackRes.ok) {
      items = await fallbackRes.json();
    }
  }

  log.info("Inventory results", { query: searchQuery, count: items?.length || 0 });

  if (!items || items.length === 0) {
    return result(
      `I don't see ${product} in our current inventory. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`
    );
  }

  const lines = [];
  for (const item of items.slice(0, 3)) {
    const name = item.description || "Unknown";
    const price =
      item.price && parseFloat(item.price) > 0
        ? `$${parseFloat(item.price).toFixed(2)}`
        : "price not listed";
    const qoh = item.qoh || 0;

    lines.push(qoh > 0 ? `${name} — ${price}, ${qoh} in stock` : `${name} — ${price}, currently out of stock`);
  }

  let response;
  if (lines.length === 1) {
    const qoh = items[0].qoh || 0;
    if (qoh > 0) {
      response = `Yes, we have ${lines[0]}. Want me to set one aside for you?`;
    } else {
      response = `We have ${items[0].description} but it's currently out of stock. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`;
    }
  } else {
    response = `Here's what I found: ${lines.join(". ")}. Any of those sound right?`;
  }

  return result(response);
}

export async function handleSuggestAlternatives(params, db, log) {
  const category = params.category || "";
  if (!category) {
    return result("What type of spirit are you looking for? Bourbon, tequila, scotch, wine?");
  }

  const priceLow = params.price_range_low || 0;
  const priceHigh = params.price_range_high || 9999;
  const maxResults = params.max_results || 3;

  log.info("Suggesting alternatives", { category, priceLow, priceHigh });

  let path = `inventory?select=description,price,qoh,category&in_stock=eq.true&price=gt.${priceLow}&price=lt.${priceHigh}&category=ilike.*${encodeURIComponent(category)}*&order=qoh.desc&limit=${maxResults}`;

  const res = await db.query(path);
  if (!res.ok) {
    return result("I'm having trouble looking that up. Can I have someone call you back with options?");
  }

  const items = await res.json();
  if (!items || items.length === 0) {
    return result(`I don't see anything in that category and price range right now. Want me to check something else?`);
  }

  const suggestions = items.map(
    (item) => `${item.description} — $${parseFloat(item.price).toFixed(2)}, ${item.qoh} in stock`
  );

  return result(`Here are some alternatives: ${suggestions.join(". ")}. Any of those interest you?`);
}

function result(text) {
  return Response.json({ results: [{ result: text }] });
}
