async function triggerTimberbornAction(action) {
  await axios.post(`http://localhost:8080/api/${action}`);
  console.log(`Ação ${action} enviada para Timberborn!`);
}