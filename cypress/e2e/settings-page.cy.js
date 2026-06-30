describe('Settings Page', () => {
  it('loads and displays settings content', () => {
    cy.visit('/settings');
    cy.contains('Settings');
    cy.contains('Configure your preferences');
    // If you have a form or input, you can add:
    // cy.get('input[name="email"]').type('test@example.com');
    // cy.contains('Save').click();
    // cy.contains('Settings saved'); // or whatever confirmation you show
  });
});