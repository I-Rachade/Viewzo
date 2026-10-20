import { namesMatch } from './names';

describe('namesMatch', () => {
  it('ignores order, accents and case', () => {
    expect(namesMatch('Kossi Mensah', 'MENSAH Kossi')).toBe(true);
    expect(namesMatch('Akouvi Ékué', 'akouvi ekue')).toBe(true);
  });

  it('accepts a missing middle name', () => {
    expect(namesMatch('Kossi Edem Mensah', 'Kossi Mensah')).toBe(true);
  });

  it('refuses another person', () => {
    expect(namesMatch('Kossi Mensah', 'Kossi Agbeko')).toBe(false);
    expect(namesMatch('Kossi Mensah', '')).toBe(false);
  });
});
