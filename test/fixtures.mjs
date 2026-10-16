// Circle's documented packed EVM format, assembled separately from the app validator.
// Never submitted to a real contract. A real attestation must also carry Circle's signature.
export function attestationFor(intent) {
  const word = (value, bytes) => BigInt(value).toString(16).padStart(bytes * 2, '0');
  const s = intent.spec;
  const addresses = ['sourceContract', 'destinationContract', 'sourceToken', 'destinationToken', 'sourceDepositor', 'destinationRecipient', 'sourceSigner', 'destinationCaller'];
  const spec = 'ca85def7' + word(s.version, 4) + word(s.sourceDomain, 4) + word(s.destinationDomain, 4) + addresses.map(key => s[key].slice(2)).join('') + word(s.value, 32) + s.salt.slice(2) + '00000000';
  return '0xff6fb334' + word(intent.maxBlockHeight, 32) + word(spec.length / 2, 4) + spec;
}
