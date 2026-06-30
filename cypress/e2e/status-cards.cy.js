describe('Status Cards', () => {
  it('are visible on the dashboard', () => {
    cy.visit('/dashboard');
    cy.contains('Completed Applications');
    cy.contains('Jobs in Queue');
    cy.contains('Preview Applications');
  });

  // If status cards are clickable and should navigate or update UI, add:
  // it('navigates or updates UI when a status card is clicked', () => {
  //   cy.visit('/dashboard');
  //   cy.contains('Completed Applications').click();
  //   // Assert navigation or UI update here
  // });
});