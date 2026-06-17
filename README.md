# scoreboard-bot
A discord bot to submit clips for new world scoreboards

Uses https://github.com/goatfryed/nw-scoreboard-reader and discord.js to create a bot that can be used to submit clips for new world scoreboards.

## Getting started
Bot owner will issue access. Server admin has to install bot

## Commands

### `/scoreboard-setup`
Configures the technical scoreboard connection settings.
* **Permissions**: Defaults to requiring `Manage Guild` (Manage Server) permission.
* **Arguments**:
  * `mode` (String, Required): The prefix for the workflow mode (e.g., `opr`, `zoo`).
  * `sheets_url` (String, Required): The URL of the Google Sheet to post with the screenshots.
  * `resolutions` (String, Required): A comma-separated list of allowed resolutions (e.g., `1920,2560`) that will populate the submit command's autocomplete.

### `/scoreboard-configure`
Configures the communication settings for the server.
* **Permissions**: Defaults to requiring `Manage Guild` (Manage Server) permission.
* **Arguments**:
  * `channel` (Channel, Required): The target channel where successful scoreboard screenshots and sheet links will be posted.
  * `error_channel` (Channel, Optional): The channel where processing error messages will be sent.
  * `ping_role` (Role, Optional): The role to ping when stats are posted.

### `/scoreboard-submit`
Submits a clip to the processing pipeline. Can be run in any channel on the server.
* **Permissions**: Defaults to requiring `Administrator` permission.
* **Arguments**:
  * `clip` (String, Required): Twitch clip URL.
  * `resolution` (String, Required): Selected resolution (dynamic autocomplete options based on the server's configured `resolutions`).

---

## Workflow Execution & Error Flow

1. **Submission**: User runs `/scoreboard-submit` in any channel on a configured server.
2. **Immediate Feedback**: The bot instantly responds with "Accepted, please await processing...".
3. **Workflow Dispatch**: The bot calls the GitHub Actions API to trigger the workflow using inputs:
   * `clip_url`: The submitted `clip`.
   * `mode`: The concatenated server `mode` + chosen `resolution` (e.g., `opr` + `1920` = `opr1920`).
4. **Polling & Completion**: The bot polls the workflow run using the returned run ID.
5. **Success Handling**: Once the run completes successfully, the bot downloads the action's artifact ZIP, extracts the stitched scoreboard screenshot and sheet screenshot, and posts them along with the `sheets_url` and the `clip` URL to the configured `channel`.
6. **Failure Handling**: If the workflow run fails, the bot will:
   * DM the submitting user with the error details.
   * Send the error message to the configured `error_channel` (if one was provided in the configuration).


## Development
### Tools
typescript, pnpm

### Process
Upload details

```bash
curl -X POST \                                                              ✔  OVERTYPE 
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_PAT" \
  https://api.github.com/repos/goatfryed/nw-scoreboard-reader/actions/workflows/parse-clip.yml/dispatches \
  -d '{"ref":"main","inputs":{"clip_url":"https://clips.twitch.tv/FancyBoxyGorillaCharlieBitMe-_sP2n_BFm8cLvTZ2","mode":"opr1920"}}'
```
to dispatch clip processing.

Somehow wait for action to finish.

Send message with sheet url and scoreboard clip and attaches stitched scoreboard screenshot and sheets screenshot from the action

