export function selectSigningIdentity(output, requested, previous) {
  const identities = [
    ...output.matchAll(
      /\b([A-Fa-f0-9]{40})\s+"((?:Apple Development|Developer ID Application):[^"\n]+)"/g,
    ),
  ].map((match) => ({ hash: match[1].toUpperCase(), name: match[2] }));
  const preferred = requested || previous;
  const matches = preferred
    ? identities.filter(
        (identity) => identity.hash === preferred.toUpperCase() || identity.name === preferred,
      )
    : identities;
  if (matches.length !== 1) {
    throw new Error(
      "Choose one available certificate with T3CODE_LOCAL_SIGNING_IDENTITY. Local updates require a persistent signing identity.",
    );
  }
  return matches[0];
}
