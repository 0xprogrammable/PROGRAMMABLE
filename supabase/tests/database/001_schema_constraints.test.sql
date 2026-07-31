begin;

select plan(46);

select has_schema('programmable_private', 'private schema exists');
select has_domain('programmable_private', 'eth_address', 'eth_address domain exists');
select has_domain('programmable_private', 'bytes32_value', 'bytes32 domain exists');
select has_domain('programmable_private', 'uint256_value', 'uint256 domain exists');
select has_domain('programmable_private', 'block_number_value', 'block-number domain exists');

select lives_ok(
  $$select decode(repeat('00', 20), 'hex')::programmable_private.eth_address$$,
  '20-byte address succeeds'
);
select throws_ok(
  $$select decode(repeat('00', 19), 'hex')::programmable_private.eth_address$$,
  '23514',
  '19-byte address is rejected'
);
select throws_ok(
  $$select decode(repeat('00', 21), 'hex')::programmable_private.eth_address$$,
  '23514',
  '21-byte address is rejected'
);
select lives_ok(
  $$select decode(repeat('00', 32), 'hex')::programmable_private.bytes32_value$$,
  '32-byte hash succeeds'
);
select throws_ok(
  $$select decode(repeat('00', 31), 'hex')::programmable_private.bytes32_value$$,
  '23514',
  '31-byte hash is rejected'
);
select throws_ok(
  $$select decode(repeat('00', 33), 'hex')::programmable_private.bytes32_value$$,
  '23514',
  '33-byte hash is rejected'
);
select lives_ok(
  $$select decode('00000000', 'hex')::programmable_private.hex_selector$$,
  '4-byte selector succeeds'
);
select throws_ok(
  $$select decode('000000', 'hex')::programmable_private.hex_selector$$,
  '23514',
  'short selector is rejected'
);
select throws_ok(
  $$select decode('0000000000', 'hex')::programmable_private.hex_selector$$,
  '23514',
  'long selector is rejected'
);

select ok(
  programmable_private.valid_profile_username('Alpha9'),
  'bounded alphanumeric profile username succeeds'
);
select ok(
  not programmable_private.valid_profile_username('ab'),
  'profile username below three characters is rejected'
);
select ok(
  not programmable_private.valid_profile_username('bad-name'),
  'profile username punctuation is rejected'
);

select ok(
  programmable_private.valid_beneficiary_set(
    array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
    array[6000, 4000],
    5
  ),
  'valid ordered beneficiary allocation succeeds'
);
select ok(
  not programmable_private.valid_beneficiary_set(
    array[decode(repeat('11', 20), 'hex'), decode(repeat('11', 20), 'hex')],
    array[6000, 4000],
    5
  ),
  'duplicate beneficiaries are rejected'
);
select ok(
  not programmable_private.valid_beneficiary_set(
    array[decode(repeat('00', 20), 'hex'), decode(repeat('22', 20), 'hex')],
    array[6000, 4000],
    5
  ),
  'zero beneficiary address is rejected'
);
select ok(
  not programmable_private.valid_beneficiary_set(
    array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
    array[0, 10000],
    5
  ),
  'zero beneficiary share is rejected'
);
select ok(
  not programmable_private.valid_beneficiary_set(
    array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
    array[6000, 3999],
    5
  ),
  'shares must total exactly ten thousand basis points'
);

select lives_ok(
  $$select programmable_private.validate_uint256(0::numeric)$$,
  'uint256 zero succeeds'
);
select lives_ok(
  $$select programmable_private.validate_uint256(
    115792089237316195423570985008687907853269984665640564039457584007913129639935::numeric
  )$$,
  'uint256 maximum succeeds'
);
select throws_ok(
  $$select programmable_private.validate_uint256(
    115792089237316195423570985008687907853269984665640564039457584007913129639936::numeric
  )$$,
  '22003',
  '2^256 is rejected'
);
select throws_ok(
  $$select programmable_private.validate_uint256(-1::numeric)$$,
  '22003',
  'negative uint256 is rejected'
);
select throws_ok(
  $$select programmable_private.validate_uint256(0.1::numeric)$$,
  '22003',
  '0.1 aborts before any rounded domain assignment'
);
select throws_ok(
  $$select programmable_private.validate_uint256(1.5::numeric)$$,
  '22003',
  '1.5 aborts before any rounded domain assignment'
);
select throws_ok(
  $$select programmable_private.validate_uint256(-0.1::numeric)$$,
  '22003',
  '-0.1 aborts before any rounded domain assignment'
);
select lives_ok(
  $$select programmable_private.parse_uint256_decimal('1')$$,
  'canonical decimal succeeds'
);
select throws_ok(
  $$select programmable_private.parse_uint256_decimal('01')$$,
  '22P02',
  'leading-zero decimal is rejected'
);
select throws_ok(
  $$select programmable_private.parse_uint256_decimal('1e2')$$,
  '22P02',
  'exponent decimal is rejected'
);
select lives_ok(
  $$select 9223372036854775807::programmable_private.block_number_value$$,
  'maximum block domain value succeeds'
);
select throws_ok(
  $$select (-1)::programmable_private.block_number_value$$,
  '23514',
  'negative block number is rejected'
);
select lives_ok(
  $$select 2147483647::programmable_private.transaction_index_value$$,
  'signed-32-bit transaction-index boundary succeeds'
);
select lives_ok(
  $$select 2147483648::programmable_private.transaction_index_value$$,
  'first unsigned-only transaction-index value succeeds'
);
select lives_ok(
  $$select 4294967295::programmable_private.transaction_index_value$$,
  'explicit transaction-index ceiling succeeds'
);
select throws_ok(
  $$select 4294967296::programmable_private.transaction_index_value$$,
  '23514',
  'transaction index above explicit ceiling is rejected'
);
select lives_ok(
  $$select 2147483647::programmable_private.block_log_index_value$$,
  'signed-32-bit block-global log-index boundary succeeds'
);
select lives_ok(
  $$select 2147483648::programmable_private.block_log_index_value$$,
  'first unsigned-only block-global log-index value succeeds'
);
select lives_ok(
  $$select 4294967295::programmable_private.block_log_index_value$$,
  'explicit block-global log-index ceiling succeeds'
);
select throws_ok(
  $$select 4294967296::programmable_private.block_log_index_value$$,
  '23514',
  'block-global log index above explicit ceiling is rejected'
);
select lives_ok(
  $$select 2147483647::programmable_private.receipt_log_ordinal_value$$,
  'signed-32-bit receipt-local ordinal boundary succeeds'
);
select lives_ok(
  $$select 2147483648::programmable_private.receipt_log_ordinal_value$$,
  'first unsigned-only receipt-local ordinal value succeeds'
);
select lives_ok(
  $$select 4294967295::programmable_private.receipt_log_ordinal_value$$,
  'explicit receipt-local ordinal ceiling succeeds'
);
select throws_ok(
  $$select 4294967296::programmable_private.receipt_log_ordinal_value$$,
  '23514',
  'receipt ordinal above explicit ceiling is rejected'
);

select * from finish();
rollback;
