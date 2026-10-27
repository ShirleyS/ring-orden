import { createOrder, applyOperation } from '../src/index.ts';
let order = createOrder('cafe_demo', 'order_example');
order = applyOperation(order, {action:'add_item',catalog_item_id:'iced_latte',quantity:2,modifier_ids:['oat_milk']});
order = applyOperation(order, {action:'remove_modifier',target:{line_id:order.items[1].line_id},modifier_id:'oat_milk'});
order = applyOperation(order, {action:'add_modifier',target:{line_id:order.items[0].line_id},modifier_id:'decaf'});
order = applyOperation(order, {action:'add_modifier',target:{line_id:order.items[0].line_id},modifier_id:'extra_shot'});
order = applyOperation(order, {action:'confirm_order',confirmed:true});
console.log(JSON.stringify(order, null, 2));
// Expected: CONFIRMED; two independently addressable lattes; total 183 MXN.
