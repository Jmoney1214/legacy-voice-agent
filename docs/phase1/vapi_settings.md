# Vapi Configuration — Optimal Settings

## Model Tab
- **Provider:** OpenAI
- **Model:** gpt-4o-mini (CRITICAL — gpt-4o is too slow for voice, causes hanging)
- **Temperature:** 0.7
- **Max Tokens:** 250 (keeps responses short and snappy)
- **System Prompt:** Paste contents of `system_prompt_vapi.md`

## Voice Tab
- **Provider:** ElevenLabs (NOT OpenAI — OpenAI voices sound robotic)
- **Voice:** "Josh" (warm natural male) or "Rachel" (warm natural female)
- **If ElevenLabs unavailable:** Use OpenAI voice "ash" or "ballad"
- **Stability:** 0.5
- **Similarity Boost:** 0.75

## Transcriber Tab
- **Provider:** Deepgram (fastest transcription, lowest latency)
- **Model:** nova-2
- **Language:** en

## First Message
"Thanks for calling Legacy Wine and Liquor. How can I help you today?"

## Advanced Tab
- **Silence Timeout:** 30 seconds
- **Max Duration:** 600 seconds (10 minutes)
- **Response Delay:** 0 ms (or minimum available)
- **End Call Phrases:** "goodbye", "that's all", "have a good one", "thanks bye"
- **Forwarding Phone Number:** +14078787003 (Jay's direct line)
- **Dial Keypad Function:** Enabled
- **End Call Function:** Enabled

## Phone Number Settings
- **Number:** +1 (407) 250-7267
- **Inbound Assistant:** Riley (your assistant name)
- **Server URL:** LEAVE BLANK (no backend needed for Phase 1)
- **SMS Enabled:** On

## Tools Tab
- **ZERO tools.** Delete all tools. No function calls for Phase 1.

## Analysis Tab
- **Structured Outputs:** Skip for now (optional, not required)

## Common Issues & Fixes
| Problem | Cause | Fix |
|---------|-------|-----|
| Agent hangs after greeting | Function calls with no server URL | Remove all tools, clear server URL |
| Robotic voice | Using OpenAI default voices | Switch to ElevenLabs Josh/Rachel |
| Long pause before answering | gpt-4o too slow | Switch to gpt-4o-mini |
| Call drops after question | Server URL pointing to dead endpoint | Clear server URL field |
| Agent rambles too long | Temperature too high, no token limit | Set temp 0.7, max tokens 250 |
