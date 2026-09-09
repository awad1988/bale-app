(function(){
  const CARD_ID='italianApprovedSaleCard';

  function removeLegacyCard(){
    const card=document.getElementById(CARD_ID);
    if(card) card.remove();
  }

  // The Italian sale is already recorded and its details belong inside
  // Hamoudeh Al-Itali's customer statement. Do not show a global card on
  // the customers page anymore.
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',removeLegacyCard);
  }else{
    removeLegacyCard();
  }
})();
