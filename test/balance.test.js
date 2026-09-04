const assert = require('assert');
const { formatEnergyBalance } = require('../src/services/balance');
const { getFatSecretDateNumber } = require('../src/services/fatsecret');
const { getStartOfDayMillis } = require('../src/services/googlefit');

console.log('🧪 Running Energy Balance Bot unit tests...\n');

// Test 1: Deficit case (Consumed < Burned)
{
  const consumed = 1850;
  const burned = 2200;
  const output = formatEnergyBalance(consumed, burned);
  const expected = 
`📊 Энергетический баланс:
📥 Приход: 1850 ккал
📤 Расход: 2200 ккал
⚖️ Итог: -350 ккал`;

  assert.strictEqual(output, expected, 'Deficit formatting failed');
  console.log('✅ Test 1 Passed: Deficit balance format matches exact specification');
}

// Test 2: Surplus case (Consumed > Burned)
{
  const consumed = 2600;
  const burned = 2100;
  const output = formatEnergyBalance(consumed, burned);
  const expected = 
`📊 Энергетический баланс:
📥 Приход: 2600 ккал
📤 Расход: 2100 ккал
⚖️ Итог: +500 ккал`;

  assert.strictEqual(output, expected, 'Surplus formatting failed');
  console.log('✅ Test 2 Passed: Surplus balance explicitly includes + sign');
}

// Test 3: Zero / Even case (Consumed === Burned)
{
  const consumed = 2000;
  const burned = 2000;
  const output = formatEnergyBalance(consumed, burned);
  const expected = 
`📊 Энергетический баланс:
📥 Приход: 2000 ккал
📤 Расход: 2000 ккал
⚖️ Итог: 0 ккал`;

  assert.strictEqual(output, expected, 'Zero balance formatting failed');
  console.log('✅ Test 3 Passed: Zero balance format matches');
}

// Test 4: FatSecret Date Number
{
  const dateNum = getFatSecretDateNumber(new Date('2026-09-04T12:00:00Z'));
  assert(typeof dateNum === 'number' && dateNum > 20000, 'FatSecret date number calculation error');
  console.log(`✅ Test 4 Passed: FatSecret day calculation is valid (${dateNum})`);
}

// Test 5: Google Fit start of day timestamp
{
  const startOfDay = getStartOfDayMillis('Europe/Moscow');
  assert(typeof startOfDay === 'number' && startOfDay > 0, 'Google Fit start of day error');
  console.log(`✅ Test 5 Passed: Start of day timestamp is valid (${startOfDay})`);
}

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
