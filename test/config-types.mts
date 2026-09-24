import { defineConfig } from 'oxlint';
import defaultPlugin, { noSelfPositioning, recommended } from 'oxlint-tw-no-self-positioning';

defineConfig({
  extends: [noSelfPositioning.recommended, defaultPlugin.recommended, recommended],
  rules: { 'tw-no-self-positioning/no-dimensions': 'off' },
});

const rule: keyof typeof noSelfPositioning.recommended.rules = 'tw-no-self-positioning/no-margin';
void rule;

// @ts-expect-error Unknown rules must not appear in the recommended rule names.
const unknownRule: keyof typeof noSelfPositioning.recommended.rules = 'tw-no-self-positioning/unknown';
void unknownRule;
