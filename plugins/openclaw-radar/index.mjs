// Copyright (c) 2026 Carlos Felipe. MIT.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { registerRadarTool } from './tool.mjs';

export default definePluginEntry({
  id: 'radar-hub-readonly',
  name: 'Radar Hub Read Only',
  description: 'Original Radar adapter for governed CRM previews.',
  register(api) { registerRadarTool(api); }
});
