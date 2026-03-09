<div align="center">
  <img src="https://media.githubusercontent.com/media/little-samo/CI/master/assets/characters/samo/profile.png" alt="Little Samo Mascot" width="250" />
  <h1>SamoAI-Example-CLI</h1>
  <p><em>An example CLI application for interacting with <a href="https://github.com/little-samo/SamoAI">@little-samo/samo-ai</a> agents in your terminal</em></p>
</div>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#customization">Customization</a> •
  <a href="#learn-more">Learn More</a> •
  <a href="#license">License</a>
</p>

## Features

- Interactive chat with SamoAI agents in your terminal
- Support for multiple agents that retain their personality and memory
- Easy-to-use command line interface

## Installation

1. Install dependencies:
   ```
   npm install
   ```

2. Set up environment variables:
   ```
   cp .env.example .env
   ```
   
   Then edit the `.env` file and add your LLM API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key
   ANTHROPIC_API_KEY=your_anthropic_api_key
   GOOGLE_AI_API_KEY=your_google_ai_api_key
   ```
   
   At least one API key is required for the agents to function properly.

## Usage

Start a chat session with the default agents (Samo and Nyx) by running:

```
npm run chat
```

You can also specify which agents to chat with:

```
npm run chat -- -- --agents samo
```

Or:

```
npm run chat -- -- --agents "samo,nyx"
```

> **Note:** The double dashes (`-- --`) are important! The first set tells npm that what follows are arguments for the script, and the second set is needed for proper argument parsing within the script itself.

You can exit the chat session by pressing `Ctrl+C`.

## Customization

### Agents

Create or modify agents by adding or editing JSON files in the `models/agents` directory. Example agents like Little Samo can be found in `models/agents/samo.json`.

### Locations

Customize interaction spaces by managing JSON files in the `models/locations` directory. Example: `models/locations/empty.json`.

When running the chat command, you can specify which location to use:

```
npm run chat -- -- --location custom_location
```

> **Important:** Remember to include both sets of double dashes (`-- --`) when passing arguments to the chat command.

## Polymarket Trading Example

This project includes a multi-agent Polymarket trading setup where three agents collaborate inside the `polymarket_trading` location to discover, verify, and execute prediction market trades.

### Prerequisites

This setup is designed to use the [`little-samo/SamoAI-MCP-Polymarket`](https://github.com/little-samo/SamoAI-MCP-Polymarket) MCP server. Run that server locally, follow its setup instructions, and start it on `http://localhost:11188`.

The MCP server supports both read-only market discovery and authenticated trading. If you do not configure Polymarket credentials, market data tools can still work, but order placement will not.

### Agents

| Agent | Model Family | Role |
|-------|--------------|------|
| **Mimo** | Gemini | Team Lead & Market Scout — interprets user commands, directs the team, and discovers opportunities |
| **Marimo** | Claude | Market Verification Analyst — validates liquidity, price action, order book conditions, and external context |
| **Casimo** | GPT | Trade Executor — places orders, manages positions, and tracks portfolio exposure |

### Strategy

- Prefer liquid markets that close in roughly `3` to `24` hours and appear highly settled.
- Treat prices around `0.80` to `0.92` as the default working range for near-settled ideas.
- Use recent volume, spread, and order book depth to avoid thin markets that are difficult to enter or exit cleanly. A spread of roughly `0.03` or tighter is a useful default standard.
- Default to about `1.5%` of capital per market across roughly `10` to `12` positions when enough independent opportunities exist. Allow `2.0%` sizing only for unusually strong verified setups.
- Prefer diversified exposure across unrelated markets instead of stacking multiple highly correlated positions on the same event, asset, or price ladder.
- If a market cannot be verified quickly and confidently, skip it and move on to another one.

### Workflow

1. You provide a trading strategy or direction
2. **Mimo** interprets your command, scans Polymarket, and directs the team
3. **Marimo** verifies the opportunity using market data, liquidity checks, and web search
4. If the verification is weak or inconclusive, the team abandons that market and continues searching
5. **Casimo** executes the trade, re-checks price before entry, and monitors positions

### Running

```
npm run chat -- -- --agents "mimo,marimo,casimo" --location polymarket_trading
```

### Live Performance

Want to see how the strategy performs in the wild? You can follow the trading results on the official Little Samo Polymarket profile: [polymarket.com/@littlesamo](https://polymarket.com/@littlesamo).

## Learn More

To learn more about SamoAI, visit the [SamoAI repository](https://github.com/little-samo/SamoAI).

## License

[MIT License](LICENSE)

---

<div align="center">
  <p>Made with ❤️ by the SamoAI Team</p>
</div>