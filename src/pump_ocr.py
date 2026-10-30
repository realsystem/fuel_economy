import cv2
import pytesseract
import re
import sys
from PIL import Image
import numpy as np


# -------------------------
# Main OCR function
# -------------------------
def run_ocr(image_path):
    img = cv2.imread(image_path)

    # Grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # print("gray")
    # cv2.imshow("gray", gray)
    # cv2.waitKey(0)
    # cv2.destroyAllWindows()

    inverted_gray = cv2.bitwise_not(gray)
    print("inverted_gray")
    cv2.imshow("inverted_gray", inverted_gray)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Apply Gaussian Blur
    # Reduce high-frequency noise while preserving significant edges.
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    # print("blurred")
    # cv2.imshow("blurred", blurred)
    # cv2.waitKey(0)
    # cv2.destroyAllWindows()

    # Canny Edge Detection
    # Canny is highly effective at finding clear, continuous edges.
    # The thresholds (e.g., 50 and 150) define what intensity gradient constitutes an edge.
    edges = cv2.Canny(blurred, 50, 150)
    print("edges")
    cv2.imshow("edges", edges)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    H, W = edges.shape[:2] 
    total_image_area = H * W

    # Find Contours
    # cv2.RETR_EXTERNAL retrieves only the extreme outer contours.
    #TODO second(small) line can't detect contour for 8
    contours, _ = cv2.findContours(edges.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

    # Filter for the Screen (Largest, Rectangular Area)
    screen_contour = None
    MIN_AREA_THRESHOLD = 5
    MAX_VALID_AREA_FOUND = 0

    for c in contours:
        # contour_img = img.copy()
        # cv2.drawContours(contour_img, c, -1, (0, 0, 255), 3)
        # cv2.imshow("Detected Contours", contour_img)
        # cv2.waitKey(0)
        # cv2.destroyAllWindows()

        hull = cv2.convexHull(c)
        x, y, w, h = cv2.boundingRect(hull)

        # Skip if the aspect ratio is too extreme (e.g., a long thin line)
        aspect_ratio = w / h
        if aspect_ratio < 0.5 or aspect_ratio > 5.0:
            continue

        # Create the clean 4-point rectangle
        screen_rectangle = np.array([
            [[x, y]], 
            [[x + w, y]], 
            [[x + w, y + h]], 
            [[x, y + h]]
        ], dtype=np.int32)

        box_area = w * h

        # Use your inverted selection logic on the area
        if box_area > MIN_AREA_THRESHOLD:
            if box_area > MAX_VALID_AREA_FOUND:
                # We found a better candidate!
                screen_contour = screen_rectangle
                MAX_VALID_AREA_FOUND = box_area

                new_canvas = img.copy()
                cv2.drawContours(new_canvas, [screen_contour], 0, (125, 0, 0), 4)
                print("screen_contour")
                cv2.imshow("screen_contour", new_canvas)
                cv2.waitKey(0)
                cv2.destroyAllWindows()

    if screen_contour is not None:
        # Get the minimum bounding rectangle (x, y, w, h)
        x, y, w, h = cv2.boundingRect(screen_contour)
        
        # Crop the original color image
        cropped_screen = img[y:y + h, x:x + w]
        
        # Now, pass 'cropped_screen' to your existing OCR preprocessing pipeline.
        # The previous 'gray' image will now be: 
        gray = cv2.cvtColor(cropped_screen, cv2.COLOR_BGR2GRAY)
        print("new gray")
        cv2.imshow("new gray", gray)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    # Split the image
    thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, 5)
    print("thresh")
    cv2.imshow("thresh", thresh)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    projection = np.sum(thresh, axis=1)
    H, W = thresh.shape[:2]

    # Initialize trackers
    start_y = 0
    min_projection_sum = 99999999
    split_point_raw = -1 

    # Only search the central region of the image where the gap should be
    # (e.g., from 30% to 70% of the image height)
    search_start = int(H * 0.3)
    search_end = int(H * 0.7)

    for y in range(search_start, search_end):
        # Check if the current row is mostly empty (projection value is low)
        if projection[y] < min_projection_sum:
            min_projection_sum = projection[y]
            split_point_raw = y

    PIXEL_BUFFER = 10
    if split_point_raw != -1:
        final_split_point = split_point_raw + PIXEL_BUFFER
    
        # Ensure the split point doesn't exceed the image boundary
        final_split_point = min(final_split_point, H - 1) 

        # --- Implement the Split ---
        line1_img = thresh[0:final_split_point, :]
        line2_img = thresh[final_split_point:H, :]
        # Now run PSM 7 OCR on line1_img and line2_img
    else:
        print("Warning: Could not reliably find the separation point.")

    # Line 1 (Gallons/Volume) - Top half
    print("line1_img")
    cv2.imshow("Line 1", line1_img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Line 2 (Price/Cost) - Bottom half
    print("line2_img")
    cv2.imshow("Line 2", line2_img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Crop
    contours, _ = cv2.findContours(line1_img.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    # Initialize variables to hold the coordinates of the combined box
    H, W = line1_img.shape[:2]
    min_x, min_y = W, H
    max_x, max_y = 0, 0

    # Set a minimum area to filter out tiny noise (adjust if needed)
    MIN_COMPONENT_AREA = 50
    MAX_ASPECT_RATIO = 1.5
    PIXEL_MARGIN = 22

    for c in contours:
        # Get the bounding box for the current digit contour
        x, y, w, h = cv2.boundingRect(c)
        # Get the area of the contour
        area = w * h
        
        if area > MIN_COMPONENT_AREA and h > 0:
            aspect_ratio = w / h

            # Filter: Check if the shape is too long and thin (i.e., not a chunky digit)
            if aspect_ratio > MAX_ASPECT_RATIO:
                continue

            # Update the overall minimum and maximum coordinates
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x + w)
            max_y = max(max_y, y + h)

    # Calculate the final combined width and height
    final_w = max_x - min_x
    final_h = max_y - min_y

    # Check if a valid region was found
    if final_w > 0 and final_h > 0:
        # Add buffer
        buffered_min_x = max(0, min_x - PIXEL_MARGIN)
        buffered_min_y = max(0, min_y - PIXEL_MARGIN)
        
        # New maximum coordinates (push outward, clipped at W or H)
        buffered_max_x = min(W, max_x + PIXEL_MARGIN)
        buffered_max_y = min(H, max_y + PIXEL_MARGIN)

        # Use the buffered coordinates for slicing
        cropped_line1_img = line1_img[buffered_min_y:buffered_max_y, buffered_min_x:buffered_max_x]
        
        # You can now proceed to OCR using 'cropped_line1_img'
        print("cropped_line1_img")
        cv2.imshow("Cropped Line 1", cropped_line1_img)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    else:
        print("Warning: Could not find any significant digit components in the line slice.")
        return None

    # Make bold font
    # Define a small kernel
    kernel = np.ones((4, 4), np.uint8)
    iterations = 1

    # Apply dilation to the original thresholded image
    eroded_line1_img = cv2.erode(cropped_line1_img, kernel, iterations=iterations)

    print("eroded_line1_img")
    cv2.imshow("Eroded Line 1", eroded_line1_img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Run OCR
    config = "--oem 3 -c tessedit_char_whitelist=0123456789 --psm 7"
    raw_digits_line1 = pytesseract.image_to_string(eroded_line1_img, config=config).strip()
    print("raw_digits_line1: ", raw_digits_line1)

    # Processing dot
    inverted_line1_img = cv2.bitwise_not(cropped_line1_img)
    H, W = inverted_line1_img.shape[:2]
    kernel = np.ones((2, 2), np.uint8)
    closed_digits_img = cv2.morphologyEx(inverted_line1_img, cv2.MORPH_CLOSE, kernel)
    color_img = cv2.cvtColor(cropped_line1_img, cv2.COLOR_GRAY2BGR)
    kernel_large = np.ones((int(H/2), int(W/2)), np.uint8)
    eroded_digits = cv2.erode(closed_digits_img, kernel_large, iterations=1)
    dot_feature_img = cv2.subtract(closed_digits_img, eroded_digits)
    dot_contours, _ = cv2.findContours(dot_feature_img.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    print("Dot Feature Isolation")
    cv2.imshow("Dot Feature Isolation", dot_feature_img)
    cv2.waitKey(0)

    cv2.drawContours(color_img, dot_contours, -1, (0, 0, 255), 2)
    print("Detected Dot Contours on Color Image")
    cv2.imshow("Detected Dot Contours", color_img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    dot_x_position = -1
    max_dot_area = 0

    for dot_c in dot_contours:
        # Filter by area: The dot should be a small, but not microscopic, feature.
        dot_area = cv2.contourArea(dot_c)
        
        # Use bounds (e.g., area between 5 and 50 pixels) to filter noise. Adjust these bounds.
        if 5 < dot_area < 50:
            # Get the bounding box of the dot
            x, y, w, h = cv2.boundingRect(dot_c)
            
            # We assume the largest valid small contour is the real dot
            if dot_area > max_dot_area:
                # We use the horizontal center of the dot as the key position
                dot_x_position = x + w // 2 
                max_dot_area = dot_area
    text1 = None
    if dot_x_position != -1 and raw_digits_line1:
        # We need to know the average width of a single digit
        # Since all digits are in 'raw_digits_line1', their combined width is 'W'
        avg_digit_width = W / len(raw_digits_line1)
        
        # The number of digits before the dot is based on dividing the dot's X position 
        # by the average digit width.
        num_digits_before_dot = round(dot_x_position / avg_digit_width)
        
        # --- Final Parsing ---
        if 0 < num_digits_before_dot < len(raw_digits_line1):
            text1 = (
                raw_digits_line1[:num_digits_before_dot] + 
                '.' + 
                raw_digits_line1[num_digits_before_dot:]
            )
        else:
            print("Error: Geometric dot insertion position is outside the valid range.")
    else:
        # Fallback to a reasonable default or error handling
        print("Error: Decimal point was not found geometrically.")
        text1 = raw_digits_line1

    config = "--oem 3 -c tessedit_char_whitelist=0123456789. --psm 8"
    text2 = pytesseract.image_to_string(line2_img, config=config).strip()

    print(f"Line 1 (Gallons/Volume): '{text1}'")
    print(f"Line 2 (Price/Cost): '{text2}'")

    cv2.destroyAllWindows()

# -------------------------
# CLI entry
# -------------------------
if __name__ == "__main__":
    path = sys.argv[1]
    result = run_ocr(path)
