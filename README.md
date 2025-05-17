<div align="center">
  <img src="https://raw.githubusercontent.com/little-samo/SamoAI/master/docs/static/img/samo_mascot.png" alt="SamoAI Mascot" width="250" />
  <h1>SamoAI-Example-CLI</h1>
  <p><em>An example CLI application for interacting with <a href="https://github.com/little-samo/SamoAI">@little-samo/samo-ai</a> agents in your terminal</em></p>
</div>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#requirements">Requirements</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#customization">Customization</a> •
  <a href="#learn-more">Learn More</a> •
  <a href="#license">License</a>
</p>

## Features

- Interactive chat with SamoAI agents in your terminal
- Support for multiple agents (Samo, Nyx) that retain their personality and memory
- Easy-to-use command line interface

## Requirements

- Node.js >=22.0.0

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/little-samo/SamoAI-Example-CLI.git
   cd SamoAI-Example-CLI
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create necessary directories:
   ```
   mkdir -p models/agents models/locations states/agents states/locations
   ```

4. Set up environment variables:
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
npm run chat -- --agents samo
```

Or:

```
npm run chat -- --agents samo,nyx
```

You can exit the chat session by pressing `Ctrl+C`.

## Customization

### Agents

Create or modify agents by adding or editing JSON files in the `models/agents` directory. Example agents like Nyx can be found in `models/agents/samo.json`.

### Locations

Customize interaction spaces by managing JSON files in the `models/locations` directory. Example: `models/locations/empty.json`.

When running the chat command, you can specify which location to use:

```
npm run chat -- --location custom_location
```

## Learn More

To learn more about SamoAI, visit the [SamoAI repository](https://github.com/little-samo/SamoAI).

## License

[MIT License](LICENSE)

---

Made with ❤️ by the SamoAI Team