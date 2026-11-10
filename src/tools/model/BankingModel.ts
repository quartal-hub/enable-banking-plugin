/** A bank (ASPSP) available through Enable Banking */
export interface Bank {
  /** Bank name, as used in `startAuthorization` */
  name: string;
  /** Two-letter country code */
  country: string;
  /** Logo URL */
  logo?: string;
  /** Customer types the bank supports, e.g. `personal`, `business` */
  psuTypes?: string[];
}
