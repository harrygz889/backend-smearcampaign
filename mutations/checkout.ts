import { KeystoneContext, SessionStore } from '@keystone-next/types';
import {
  CartItemCreateInput,
  OrderCreateInput,
} from '../.keystone/schema-types';
import stripeConfig from '../lib/stripe';

interface Arguments {
  token: string;
  address: string;
}

// add address argrument here somehow
async function checkout(
  root: any,
  { token, address }: Arguments,
  context: KeystoneContext
): Promise<OrderCreateInput> {
  // 1. make sure they are signed in
  const userId = context.session.itemId;
  if (!userId) {
    throw new Error('Sorry, you must be signed in to create an order!');
  }
  // 1.5 query the current user
  const user = await context.lists.User.findOne({
    where: { id: userId },
    resolveFields: `
      id
      name
      email
      cart {
        id
        quantity
        size
        product {
          name
          price
          shippingPrice
          description
          id
          photo {
            id
            image {
              id
              publicUrlTransformed
            }
          }
        }
      }
    `,
  });
  console.dir(user, { depth: null });
  // 2. calc the total price of the order
  const cartItems = user.cart.filter((cartItem) => cartItem.product);

  // TODO: ADD SHIPPING FUNCTION CALL TO SHIPENGINE HERE

  function reducer(tally: number, cartItem: CartItemCreateInput) {
    return (
      tally +
      cartItem.quantity *
      (cartItem.product.price + cartItem.product.shippingPrice)
    );
  }
  const amount = cartItems.reduce(reducer, 0);
  console.log(amount);
  // 3. create the charge with the stripe library
  const charge = await stripeConfig.paymentIntents
    .create({
      amount,
      currency: 'USD',
      confirm: true,
      payment_method: token,
    })
    .catch((err) => {
      console.log(err);
      throw new Error(err.message);
    });

  console.log(charge);
  // 4. convert the cart items to order itmes
  const orderItems = cartItems.map((cartItem) => {
    const orderItem = {
      name: cartItem.product.name,
      size: cartItem.size,
      description: cartItem.product.description,
      price: cartItem.product.price,
      shippingPrice: cartItem.product.shippingPrice,
      quantity: cartItem.quantity,
      photo: { connect: { id: cartItem.product.photo.id } },
    };
    return orderItem;
  });
  // 5. create the order and return it
  const order = await context.lists.Order.createOne({
    data: {
      total: charge.amount,
      charge: charge.id,
      // creates the items before creating the reference
      items: { create: orderItems },
      user: { connect: { id: userId } },
      address,
    },
  });
  // 6. clean up any old cart items
  const cartItemIds = user.cart.map((cartItem) => cartItem.id);
  await context.lists.CartItem.deleteMany({
    ids: cartItemIds,
  });
  return order;
}

export default checkout;
