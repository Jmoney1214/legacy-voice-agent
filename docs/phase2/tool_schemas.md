# Tool Schemas — OpenAI Agents SDK

## Inventory Tools (Product Specialist Agent)

### search_inventory
```typescript
{
  name: "search_inventory",
  description: "Search Legacy Wine & Liquor inventory by product name, brand, or category",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Product name, brand, or category to search" },
      category: { type: "string", description: "Optional category filter: BOURBON, AMERICAN WHISKEY, SCOTCH WHISKEY, VODKA, BLANCO/SILVER, REPOSADO, ANEJO, COGNAC, GIN, RUM, WINE, etc." },
      in_stock_only: { type: "boolean", default: true },
      max_results: { type: "number", default: 5 }
    },
    required: ["query"]
  }
}
// Backend: SELECT description, category, price, qoh FROM inventory WHERE to_tsvector('english', description) @@ plainto_tsquery($query) AND ($category IS NULL OR category = $category) AND ($in_stock_only = false OR in_stock = true) ORDER BY qoh DESC LIMIT $max_results
```

### get_product_details
```typescript
{
  name: "get_product_details",
  description: "Get full details for a specific product by item ID",
  parameters: {
    type: "object",
    properties: {
      item_id: { type: "string" }
    },
    required: ["item_id"]
  }
}
```

### suggest_alternatives
```typescript
{
  name: "suggest_alternatives",
  description: "Find similar in-stock products when requested item is unavailable",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string" },
      price_range_low: { type: "number" },
      price_range_high: { type: "number" },
      max_results: { type: "number", default: 3 }
    },
    required: ["category"]
  }
}
// Backend: SELECT description, price, qoh FROM inventory WHERE category = $category AND in_stock = true AND price BETWEEN $low AND $high ORDER BY qoh DESC LIMIT $max_results
```

## Customer Tools (All Agents)

### lookup_customer
```typescript
{
  name: "lookup_customer",
  description: "Look up a customer by phone number to get their history and preferences",
  parameters: {
    type: "object",
    properties: {
      phone: { type: "string" }
    },
    required: ["phone"]
  }
}
// Backend: SELECT * FROM customers WHERE phone = $phone
```

### capture_lead
```typescript
{
  name: "capture_lead",
  description: "Save caller information for follow-up",
  parameters: {
    type: "object",
    properties: {
      phone: { type: "string" },
      name: { type: "string" },
      interest: { type: "string", description: "What they were looking for" },
      notes: { type: "string" }
    },
    required: ["phone"]
  }
}
// Backend: INSERT INTO customers (phone, first_name, product_interests, source) VALUES ($phone, $name, $interest, 'phone_call') ON CONFLICT (phone) DO UPDATE SET product_interests = $interest, updated_at = now()
```

## Waitlist Tools (Product Specialist + VIP Agent)

### add_to_waitlist
```typescript
{
  name: "add_to_waitlist",
  description: "Add caller to notification list for out-of-stock or allocated product",
  parameters: {
    type: "object",
    properties: {
      customer_phone: { type: "string" },
      customer_name: { type: "string" },
      product_requested: { type: "string" }
    },
    required: ["customer_phone", "product_requested"]
  }
}
// Backend: INSERT INTO restock_interest (customer_phone, customer_name, product_requested) VALUES ($phone, $name, $product)
```

## Call Logging Tools (Post-Call)

### log_call
```typescript
{
  name: "log_call",
  description: "Log call details after call ends",
  parameters: {
    type: "object",
    properties: {
      caller_phone: { type: "string" },
      caller_name: { type: "string" },
      call_duration: { type: "number" },
      summary: { type: "string" },
      products_discussed: { type: "array", items: { type: "string" } },
      outcome: { type: "string", enum: ["purchased", "will_visit", "will_call_back", "transferred", "waitlisted", "no_action"] },
      agent_used: { type: "string", enum: ["triage", "product_specialist", "order_support", "retention", "vip"] }
    },
    required: ["caller_phone", "summary", "outcome"]
  }
}
```

## Notification Tools

### send_sms
```typescript
{
  name: "send_sms",
  description: "Send SMS to caller with order update, follow-up, or confirmation",
  parameters: {
    type: "object",
    properties: {
      phone: { type: "string" },
      message: { type: "string" }
    },
    required: ["phone", "message"]
  }
}
```

### notify_manager
```typescript
{
  name: "notify_manager",
  description: "Send Slack notification to Jay for high-value leads or escalations",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string" },
      caller_phone: { type: "string" },
      caller_name: { type: "string" },
      urgency: { type: "string", enum: ["low", "medium", "high"] }
    },
    required: ["reason"]
  }
}
// Backend: POST to Slack webhook → #instagram-content channel (C0AQNJU7C3U)
```

## Transfer Tools

### transfer_to_human
```typescript
{
  name: "transfer_to_human",
  description: "Transfer call to Jay (store owner)",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string" }
    },
    required: ["reason"]
  }
}
// Action: Forward to +14078787003
```
